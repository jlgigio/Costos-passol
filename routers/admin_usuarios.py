"""
routers/admin_usuarios.py
CRUD de usuarios — solo accesible para administradores.
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from database import get_db
from services.auth import hash_password, decode_token, extract_token

logger = logging.getLogger("passol.admin")
router = APIRouter(prefix="/api/admin/usuarios", tags=["Administración"])

# Módulos disponibles y sus etiquetas
MODULOS = [
    "consulta", "simulador", "manuales", "clientes",
    "parametros", "import", "productos", "mp",
    "dashboard", "alertas", "historial",
]

PERMISOS_DEFAULT = {m: False for m in MODULOS}
PERMISOS_COMPLETOS = {m: True for m in MODULOS}


def require_admin(request: Request) -> dict:
    """Dependency: valida que el usuario sea administrador."""
    token = extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado.")
    payload = decode_token(token)
    if not payload.get("es_admin"):
        raise HTTPException(status_code=403, detail="Acceso restringido a administradores.")
    return payload


class UsuarioCreate(BaseModel):
    email: str
    nombre: str
    password: str
    es_admin: bool = False
    permisos: dict = {}


class UsuarioUpdate(BaseModel):
    nombre: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    es_admin: Optional[bool] = None
    permisos: Optional[dict] = None
    activo: Optional[bool] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def listar_usuarios(
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin)
):
    """Lista todos los usuarios con su perfil de acceso."""
    rows = db.execute(text("""
        SELECT id, email, nombre, es_admin, permisos, activo,
               created_at, last_login
        FROM usuarios
        ORDER BY es_admin DESC, nombre
    """)).fetchall()

    return [
        {
            "id":         r.id,
            "email":      r.email,
            "nombre":     r.nombre,
            "es_admin":   r.es_admin,
            "permisos":   r.permisos or {},
            "activo":     r.activo,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "last_login": r.last_login.isoformat() if r.last_login else None,
        }
        for r in rows
    ]


@router.post("/")
def crear_usuario(
    payload: UsuarioCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin)
):
    """Crea un nuevo usuario."""
    email = payload.email.lower().strip()

    # Verificar que el email no exista
    existe = db.execute(
        text("SELECT id FROM usuarios WHERE email = :email"),
        {"email": email}
    ).fetchone()
    if existe:
        raise HTTPException(status_code=400, detail=f"Ya existe un usuario con el email '{email}'.")

    # Normalizar permisos: asegurar que solo tenga módulos válidos
    permisos = {m: bool(payload.permisos.get(m, False)) for m in MODULOS}

    row = db.execute(
        text("""
            INSERT INTO usuarios (email, nombre, password_hash, es_admin, permisos)
            VALUES (:email, :nombre, :ph, :admin, CAST(:permisos AS jsonb))
            RETURNING id, email, nombre, es_admin, permisos, activo, created_at
        """),
        {
            "email":    email,
            "nombre":   payload.nombre.strip(),
            "ph":       hash_password(payload.password),
            "admin":    payload.es_admin,
            "permisos": json.dumps(permisos),
        }
    ).fetchone()
    db.commit()

    logger.info(f"Usuario creado: {email} (admin={payload.es_admin})")
    return {"id": row.id, "email": row.email, "nombre": row.nombre,
            "es_admin": row.es_admin, "permisos": row.permisos, "activo": row.activo}


@router.put("/{user_id}")
def actualizar_usuario(
    user_id: int,
    payload: UsuarioUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Actualiza datos de un usuario (nombre, email, password, permisos, activo)."""
    row = db.execute(
        text("SELECT id, email, es_admin FROM usuarios WHERE id = :id"),
        {"id": user_id}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    # No permitir que el admin se desactive a sí mismo
    if str(user_id) == str(admin.get("sub")) and payload.activo is False:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta.")

    updates = []
    params: dict = {"id": user_id}

    if payload.nombre is not None:
        updates.append("nombre = :nombre")
        params["nombre"] = payload.nombre.strip()

    if payload.email is not None:
        email = payload.email.lower().strip()
        # Verificar que el nuevo email no esté en uso por otro usuario
        dup = db.execute(
            text("SELECT id FROM usuarios WHERE email = :email AND id != :id"),
            {"email": email, "id": user_id}
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail=f"El email '{email}' ya está en uso.")
        updates.append("email = :email")
        params["email"] = email

    if payload.password:
        updates.append("password_hash = :ph")
        params["ph"] = hash_password(payload.password)

    if payload.es_admin is not None:
        updates.append("es_admin = :admin")
        params["admin"] = payload.es_admin

    if payload.permisos is not None:
        permisos = {m: bool(payload.permisos.get(m, False)) for m in MODULOS}
        updates.append("permisos = CAST(:permisos AS jsonb)")
        params["permisos"] = json.dumps(permisos)

    if payload.activo is not None:
        updates.append("activo = :activo")
        params["activo"] = payload.activo

    if not updates:
        raise HTTPException(status_code=400, detail="Sin cambios para aplicar.")

    db.execute(
        text(f"UPDATE usuarios SET {', '.join(updates)} WHERE id = :id"),
        params
    )
    db.commit()

    updated = db.execute(
        text("SELECT id, email, nombre, es_admin, permisos, activo FROM usuarios WHERE id = :id"),
        {"id": user_id}
    ).fetchone()

    logger.info(f"Usuario {user_id} ({updated.email}) actualizado.")
    return {"id": updated.id, "email": updated.email, "nombre": updated.nombre,
            "es_admin": updated.es_admin, "permisos": updated.permisos, "activo": updated.activo}


@router.delete("/{user_id}")
def eliminar_usuario(
    user_id: int,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin)
):
    """Elimina un usuario permanentemente. No se puede eliminar a uno mismo."""
    if str(user_id) == str(admin.get("sub")):
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta.")

    result = db.execute(
        text("DELETE FROM usuarios WHERE id = :id RETURNING email"),
        {"id": user_id}
    ).fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    db.commit()

    logger.info(f"Usuario eliminado: {result.email}")
    return {"ok": True, "email": result.email}


@router.get("/modulos")
def listar_modulos(_: dict = Depends(require_admin)):
    """Retorna la lista de módulos disponibles para asignar permisos."""
    labels = {
        "consulta":   "Consulta de Costos BOM",
        "simulador":  "Simulador What-If",
        "manuales":   "Costos Manuales",
        "clientes":   "Cadenas / Clientes",
        "parametros": "Parámetros Globales",
        "import":     "Importar BD (ERP / Google Sheets)",
        "productos":  "Historial MP / Insumos",
        "mp":         "Consulta Materias Primas",
        "dashboard":  "Dashboard Ejecutivo",
        "alertas":    "Alertas de Variación",
        "historial":  "Historial de Escenarios",
    }
    return [{"key": m, "label": labels.get(m, m)} for m in MODULOS]
