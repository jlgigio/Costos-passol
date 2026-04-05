"""
Migración: crear tabla escenarios_rentabilidad
"""
import psycopg2
import sys
sys.stdout.reconfigure(encoding='utf-8')

conn = psycopg2.connect(dbname='postgres', user='postgres', password='postgres', host='localhost', port=5432)
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS escenarios_rentabilidad (
        id                    SERIAL PRIMARY KEY,
        nombre                VARCHAR(100) NOT NULL,
        sku                   VARCHAR(50),
        nombre_sku            VARCHAR(200),
        cliente_id            INTEGER,
        cliente               VARCHAR(100),
        factor                NUMERIC(10,4) DEFAULT 1,
        descuento_max         NUMERIC(10,4) DEFAULT 0,
        comision_promedio     NUMERIC(10,4) DEFAULT 0,
        rapell                NUMERIC(10,4) DEFAULT 0,
        fee                   NUMERIC(10,4) DEFAULT 0,
        marketing             NUMERIC(10,4) DEFAULT 0,
        x_docking             NUMERIC(10,4) DEFAULT 0,
        rebate                NUMERIC(10,4) DEFAULT 0,
        rebate_centralizacion NUMERIC(10,4) DEFAULT 0,
        flete_kilo            NUMERIC(10,4) DEFAULT 0,
        pallet_kilo           NUMERIC(10,4) DEFAULT 0,
        precio_lista          NUMERIC(12,2) DEFAULT 0,
        precio_final          NUMERIC(12,2) DEFAULT 0,
        cm2_pct               NUMERIC(8,4)  DEFAULT 0,
        utilidad              NUMERIC(12,2) DEFAULT 0,
        created_at            TIMESTAMP DEFAULT NOW()
    );
""")
print("✓ Tabla escenarios_rentabilidad creada")

conn.commit()
conn.close()
print("✓ Migración completada")
