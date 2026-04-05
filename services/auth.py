"""
services/auth.py
Utilidades de autenticación: JWT, hash de contraseñas, extracción de token.
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt
from fastapi import HTTPException, Request, status

logger = logging.getLogger("passol.auth")

# ── Configuración ─────────────────────────────────────────────────────────────
SECRET_KEY      = os.getenv("SECRET_KEY", "passol-costeo-secret-2025-cambiar-en-produccion")
ALGORITHM       = "HS256"
TOKEN_EXPIRE_H  = 12   # token válido por 12 horas (jornada laboral + margen)

# Rutas que NO requieren autenticación
PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/health",
    "/api/docs",
    "/openapi.json",
}


# ── Contraseñas ───────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────
def create_token(data: dict) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_H)
    payload["exp"] = expire
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión expirada o inválida. Inicia sesión nuevamente.",
        )


def extract_token(request: Request) -> Optional[str]:
    """Extrae el Bearer token del header Authorization."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def is_public_path(path: str) -> bool:
    """Retorna True si la ruta no requiere autenticación."""
    if path in PUBLIC_PATHS:
        return True
    # Archivos estáticos del frontend
    if not path.startswith("/api/"):
        return True
    return False
