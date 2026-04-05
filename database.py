import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError
import os
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("passol.database")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError(
        "DATABASE_URL no está configurada. "
        "Revisa el archivo .env en la raíz del proyecto."
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,      # verifica la conexión antes de usarla (evita 'server closed connection')
    pool_size=5,             # conexiones simultáneas mantenidas abiertas
    max_overflow=10,         # conexiones adicionales bajo carga puntual
    pool_recycle=300,        # recicla conexiones cada 5 min (evita timeouts por idle)
    connect_args={
        "connect_timeout": 10,   # falla rápido si PostgreSQL no responde
        "application_name": "PASSOL_Costeo",
    },
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency FastAPI — provee una sesión y la cierra al terminar el request."""
    db = SessionLocal()
    try:
        yield db
    except OperationalError as e:
        logger.error(f"Error de base de datos: {e}")
        db.rollback()
        raise
    finally:
        db.close()


def check_db_connection() -> bool:
    """Verifica que la BD esté accesible. Usado por el health endpoint."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error(f"DB health check fallido: {e}")
        return False
