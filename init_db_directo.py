import os
import psycopg2
from dotenv import load_dotenv

# Scripts de migración adicionales en orden de ejecución.
# Se ejecutan DESPUÉS del schema.sql principal con IF NOT EXISTS,
# por lo que son idempotentes y seguros de repetir.
MIGRACIONES_ADICIONALES = [
    """
    -- migracion_euro: agrega valor_eur a tipos_cambio y tipo_cambio_eur a parametros
    ALTER TABLE tipos_cambio
        ADD COLUMN IF NOT EXISTS valor_eur NUMERIC(10, 2);
    ALTER TABLE parametros_comerciales
        ADD COLUMN IF NOT EXISTS tipo_cambio_eur NUMERIC(12, 2) DEFAULT 0;
    ALTER TABLE parametros_comerciales
        ADD COLUMN IF NOT EXISTS valor_uf NUMERIC(12, 2) DEFAULT 37000;
    """,
    """
    -- migracion_maestro_skus: agrega columnas de familia, subfamilia y densidad
    ALTER TABLE maestro_skus ADD COLUMN IF NOT EXISTS familia    VARCHAR(100);
    ALTER TABLE maestro_skus ADD COLUMN IF NOT EXISTS subfamilia VARCHAR(100);
    ALTER TABLE maestro_skus ADD COLUMN IF NOT EXISTS densidad   NUMERIC(10, 6);
    """,
    """
    -- migracion_factores_conversion: adapta tabla a columnas reales del ERP
    -- (solo si la tabla tiene la estructura antigua)
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='factores_conversion' AND column_name='factor_multiplicador'
        ) THEN
            ALTER TABLE factores_conversion
                DROP COLUMN IF EXISTS factor_multiplicador,
                DROP COLUMN IF EXISTS tipo_factor,
                ADD COLUMN IF NOT EXISTS unidad    VARCHAR(50),
                ADD COLUMN IF NOT EXISTS litros    NUMERIC(15,6),
                ADD COLUMN IF NOT EXISTS kilo_neto NUMERIC(15,6),
                ADD COLUMN IF NOT EXISTS kilo_bruto NUMERIC(15,6);
        END IF;
    END $$;
    """,
    """
    -- migracion_escenarios: crea tabla de escenarios guardados
    CREATE TABLE IF NOT EXISTS escenarios_rentabilidad (
        id                    SERIAL PRIMARY KEY,
        nombre                VARCHAR(200),
        sku                   VARCHAR(50),
        nombre_sku            VARCHAR(255),
        cliente_id            INTEGER,
        cliente               VARCHAR(150),
        factor                NUMERIC(8, 6),
        descuento_max         NUMERIC(8, 6),
        comision_promedio     NUMERIC(8, 6),
        rapell                NUMERIC(8, 6),
        fee                   NUMERIC(8, 6),
        marketing             NUMERIC(8, 6),
        x_docking             NUMERIC(8, 6),
        rebate                NUMERIC(8, 6),
        rebate_centralizacion NUMERIC(8, 6),
        flete_kilo            NUMERIC(12, 6),
        pallet_kilo           NUMERIC(12, 6),
        precio_lista          NUMERIC(15, 2),
        precio_final          NUMERIC(15, 2),
        cm2_pct               NUMERIC(8, 4),
        utilidad              NUMERIC(15, 2),
        created_at            TIMESTAMP DEFAULT NOW()
    );
    """,
    """
    -- migracion_productos: crea tabla de ficha por producto
    CREATE TABLE IF NOT EXISTS condiciones_producto (
        sku                   VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
        precio_venta_sugerido NUMERIC(15, 2),
        precio_piso           NUMERIC(15, 2),
        margen_objetivo_pct   NUMERIC(5, 2),
        clasificacion         VARCHAR(100),
        notas                 TEXT,
        updated_at            TIMESTAMP DEFAULT NOW()
    );
    """,
]


def init_db_psycopg2():
    print("Conectando a PostgreSQL local con psycopg2...")
    load_dotenv()

    url = os.getenv("DATABASE_URL")
    if not url:
        raise EnvironmentError("DATABASE_URL no está definida en el archivo .env")

    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, 'r', encoding='utf-8') as f:
        sql_schema = f.read()

    try:
        conn = psycopg2.connect(url)
        conn.autocommit = True
        cursor = conn.cursor()

        print("  → Aplicando schema.sql...")
        cursor.execute(sql_schema)
        print("  ✓ schema.sql aplicado")

        for i, migracion in enumerate(MIGRACIONES_ADICIONALES, 1):
            print(f"  → Aplicando migración {i}/{len(MIGRACIONES_ADICIONALES)}...")
            cursor.execute(migracion)
            print(f"  ✓ Migración {i} aplicada")

        cursor.close()
        conn.close()
        print("\n¡Esquema completo creado correctamente en PostgreSQL!")
    except Exception as e:
        print(f"\nError al ejecutar script SQL: {e}")
        raise


if __name__ == "__main__":
    init_db_psycopg2()
