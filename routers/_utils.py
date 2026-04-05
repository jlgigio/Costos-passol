"""
Utilidades compartidas entre routers.
"""
import logging
from fastapi import HTTPException

logger = logging.getLogger("passol.routers")


def handle_error(e: Exception, context: str = "") -> None:
    """
    Registra el error completo en el log y lanza una HTTPException con
    un mensaje genérico para el cliente (no expone detalles internos).
    """
    msg = f"{context}: {e}" if context else str(e)
    logger.error(msg, exc_info=True)
    raise HTTPException(status_code=500, detail="Error interno del servidor. Revisa logs/app.log.")


def require_parametros(db) -> dict:
    """
    Obtiene los parámetros comerciales (id=1) y lanza 503 si no existen.
    Evita NoneType crashes cuando la fila se borra accidentalmente.
    """
    from sqlalchemy import text
    row = db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).fetchone()
    if not row:
        logger.critical("parametros_comerciales id=1 no encontrado — la BD puede estar incompleta.")
        raise HTTPException(
            status_code=503,
            detail="Parámetros comerciales no configurados. Contacte al administrador."
        )
    return dict(row._mapping)
