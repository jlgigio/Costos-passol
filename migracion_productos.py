import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

def run_migration():
    load_dotenv()
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        raise EnvironmentError("DATABASE_URL no está definida en el archivo .env")

    engine = create_engine(DATABASE_URL)
    try:
        with engine.connect() as conn:
            # Check if table already exists
            exists = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'condiciones_producto'
                )
            """)).scalar()

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS condiciones_producto (
                    sku                   VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
                    precio_venta_sugerido NUMERIC(15,2),
                    precio_piso           NUMERIC(15,2),
                    margen_objetivo_pct   NUMERIC(5,2),
                    clasificacion         VARCHAR(100),
                    notas                 TEXT,
                    updated_at            TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()

            if exists:
                print("Tabla condiciones_producto ya existía — sin cambios.")
            else:
                print("Tabla condiciones_producto creada correctamente.")
    except Exception as e:
        print(f"Error durante la migración: {e}")
        raise

if __name__ == "__main__":
    run_migration()
