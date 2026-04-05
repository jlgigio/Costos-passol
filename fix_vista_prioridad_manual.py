"""
Invierte la prioridad de vista_ultimo_costo:
  ANTES: costos_historicos (compra) > costos_manuales
  AHORA: costos_manuales (manual) > costos_historicos (compra)

Resultado:
  - Si existe costo manual → se usa ese (fuente='manual')
  - Si no hay manual pero sí compra → se usa el de compra (fuente='compra')
  - Sin ninguno → el insumo aparece como sin_precio en la explosión
"""
import sys
import psycopg2

sys.stdout.reconfigure(encoding='utf-8')

conn = psycopg2.connect(
    dbname="postgres",
    user="postgres",
    password="postgres",
    host="localhost",
    port=5432
)
conn.autocommit = True
cur = conn.cursor()

sql = """
CREATE OR REPLACE VIEW vista_ultimo_costo AS
WITH FechaMax AS (
    SELECT sku, MAX(fecha_compra) AS fecha_max
    FROM costos_historicos
    GROUP BY sku
),
UltimaCompra AS (
    SELECT DISTINCT ON (ch.sku)
        ch.sku,
        ch.fecha_compra,
        ch.costo_unitario
    FROM costos_historicos ch
    JOIN FechaMax fm ON ch.sku = fm.sku AND ch.fecha_compra = fm.fecha_max
    ORDER BY ch.sku, ch.costo_unitario DESC
)
SELECT
    COALESCE(m.sku, c.sku)                                  AS sku,
    COALESCE(m.fecha_actualizacion, c.fecha_compra)         AS fecha_compra,
    -- Manual pisa compra cuando existe
    COALESCE(m.costo_unitario_clp, c.costo_unitario)        AS costo_unitario_clp,
    CASE
        WHEN (SELECT valor_usd FROM tipos_cambio ORDER BY fecha DESC LIMIT 1) > 0
        THEN COALESCE(m.costo_unitario_clp, c.costo_unitario)
             / (SELECT valor_usd FROM tipos_cambio ORDER BY fecha DESC LIMIT 1)
        ELSE 0
    END                                                     AS costo_unitario_usd,
    -- fuente_costo: 'manual' si hay override, 'compra' si solo hay histórico
    CASE
        WHEN m.sku IS NOT NULL THEN CAST('manual' AS VARCHAR)
        ELSE CAST('compra' AS VARCHAR)
    END                                                     AS fuente_costo
FROM UltimaCompra c
FULL OUTER JOIN costos_manuales m ON c.sku = m.sku;
"""

print("Actualizando vista_ultimo_costo...")
cur.execute(sql)
print("✓ Vista actualizada: costos_manuales ahora pisa costos_historicos")

# Verificar
cur.execute("""
    SELECT COUNT(*) FROM vista_ultimo_costo WHERE fuente_costo = 'manual'
""")
cnt = cur.fetchone()[0]
print(f"✓ Insumos con costo manual activo: {cnt}")

cur.close()
conn.close()
print("Listo.")
