"""
Migración: crea tabla precio_venta_config
"""
import psycopg2, os
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur  = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS precio_venta_config (
        sku              VARCHAR(100) PRIMARY KEY,
        margen_pct       NUMERIC(10,4) NOT NULL DEFAULT 0,
        ajuste_pct       NUMERIC(10,4) NOT NULL DEFAULT 0,
        precio_venta_clp NUMERIC(14,2) NOT NULL,
        precio_final_clp NUMERIC(14,2) NOT NULL,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW()
    );
""")

conn.commit()
cur.close()
conn.close()
print("OK — tabla precio_venta_config creada.")
