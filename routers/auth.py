"""
routers/auth.py
Endpoints de autenticación: login, perfil del usuario actual.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel

from database import get_db
from services.auth import verify_password, create_token, decode_token, extract_token

logger = logging.getLogger("passol.auth.router")
router = APIRouter(prefix="/api/auth", tags=["Autenticación"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Autentica un usuario y retorna un JWT."""
    row = db.execute(
        text("""
            SELECT id, email, nombre, password_hash, es_admin, permisos, activo
            FROM usuarios
            WHERE email = :email
        """),
        {"email": payload.email.lower().strip()}
    ).fetchone()

    if not row or not verify_password(payload.password, row.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos.")

    if not row.activo:
        raise HTTPException(
            status_code=403,
            detail="Usuario desactivado. Contacta al administrador."
        )

    # Registrar último acceso
    db.execute(
        text("UPDATE usuarios SET last_login = NOW() WHERE id = :id"),
        {"id": row.id}
    )
    db.commit()

    permisos = row.permisos or {}

    token = create_token({
        "sub":      str(row.id),
        "email":    row.email,
        "nombre":   row.nombre,
        "es_admin": row.es_admin,
        "permisos": permisos,
    })

    logger.info(f"Login exitoso: {row.email} (admin={row.es_admin})")

    return {
        "token": token,
        "usuario": {
            "id":       row.id,
            "email":    row.email,
            "nombre":   row.nombre,
            "es_admin": row.es_admin,
            "permisos": permisos,
        }
    }


@router.get("/me")
def me(request: Request):
    """Retorna los datos del usuario autenticado desde el token."""
    token = extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado.")
    return decode_token(token)
