"""
Migración: soporte EUR en el sistema de costeo
- Agrega valor_eur a tipos_cambio
- Agrega tipo_cambio_eur a parametros_comerciales
- Amplía el CHECK de costos_historicos.moneda para incluir EUR
- Recrea vista_ultimo_costo con conversión EUR→CLP
"""
import sys, psycopg2
sys.stdout.reconfigure(encoding='utf-8')

conn = psycopg2.connect(dbname='postgres', user='postgres', password='postgres', host='localhost', port=5432)
cur = conn.cursor()

# 1. tipos_cambio: agregar valor_eur
cur.execute("""
    ALTER TABLE tipos_cambio
    ADD COLUMN IF NOT EXISTS valor_eur NUMERIC(12,4) DEFAULT 0;
""")
print("✓ tipos_cambio.valor_eur agregado")

# 2. parametros_comerciales: agregar tipo_cambio_eur
cur.execute("""
    ALTER TABLE parametros_comerciales
    ADD COLUMN IF NOT EXISTS tipo_cambio_eur NUMERIC(12,4) DEFAULT 0;
""")
print("✓ parametros_comerciales.tipo_cambio_eur agregado")

# 3. costos_historicos: ampliar CHECK para incluir EUR
cur.execute("""
    ALTER TABLE costos_historicos
    DROP CONSTRAINT IF EXISTS costos_historicos_moneda_check;
""")
cur.execute("""
    ALTER TABLE costos_historicos
    ADD CONSTRAINT costos_historicos_moneda_check
    CHECK (moneda IN ('CLP', 'USD', 'EUR'));
""")
print("✓ CHECK moneda ampliado a CLP/USD/EUR")

# 4. Recrear vista_ultimo_costo con conversión EUR→CLP
cur.execute("DROP VIEW IF EXISTS vista_ultimo_costo CASCADE;")
cur.execute("""
CREATE VIEW vista_ultimo_costo AS
WITH FechaMax AS (
    SELECT sku, MAX(fecha_compra) AS fecha_max
    FROM costos_historicos
    GROUP BY sku
),
UltimaCompra AS (
    SELECT DISTINCT ON (ch.sku)
        ch.sku,
        ch.fecha_compra,
        ch.costo_unitario,
        ch.moneda
    FROM costos_historicos ch
    JOIN FechaMax fm ON ch.sku = fm.sku AND ch.fecha_compra = fm.fecha_max
    ORDER BY ch.sku, ch.costo_unitario DESC
),
TiposCambio AS (
    SELECT
        COALESCE((SELECT valor_usd FROM tipos_cambio ORDER BY fecha DESC LIMIT 1), 950) AS usd,
        COALESCE((SELECT valor_eur FROM tipos_cambio ORDER BY fecha DESC LIMIT 1), 1100) AS eur
)
SELECT
    COALESCE(m.sku, c.sku) AS sku,
    COALESCE(m.fecha_actualizacion, c.fecha_compra) AS fecha_compra,
    -- Costo en CLP: manual pisa compra; compras en USD/EUR se convierten
    COALESCE(
        m.costo_unitario_clp,
        CASE c.moneda
            WHEN 'USD' THEN c.costo_unitario * (SELECT usd FROM TiposCambio)
            WHEN 'EUR' THEN c.costo_unitario * (SELECT eur FROM TiposCambio)
            ELSE c.costo_unitario
        END
    ) AS costo_unitario_clp,
    -- Costo en USD
    CASE
        WHEN (SELECT usd FROM TiposCambio) > 0
        THEN COALESCE(
            m.costo_unitario_clp,
            CASE c.moneda
                WHEN 'USD' THEN c.costo_unitario * (SELECT usd FROM TiposCambio)
                WHEN 'EUR' THEN c.costo_unitario * (SELECT eur FROM TiposCambio)
                ELSE c.costo_unitario
            END
        ) / (SELECT usd FROM TiposCambio)
        ELSE 0
    END AS costo_unitario_usd,
    CASE
        WHEN m.sku IS NOT NULL THEN 'manual'::VARCHAR
        ELSE 'compra'::VARCHAR
    END AS fuente_costo
FROM UltimaCompra c
FULL OUTER JOIN costos_manuales m ON c.sku = m.sku;
""")
print("✓ vista_ultimo_costo recreada con soporte EUR")

conn.commit()
conn.close()
print("\n✓ Migración completada exitosamente")
