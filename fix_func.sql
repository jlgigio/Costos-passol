
DROP FUNCTION IF EXISTS explotar_costo_sku(VARCHAR);
CREATE FUNCTION explotar_costo_sku(p_sku VARCHAR)
RETURNS TABLE (
    insumo_final            VARCHAR,
    nombre_insumo           VARCHAR,
    cantidad_requerida_base DECIMAL,
    cantidad_requerida_formato DECIMAL,
    costo_unitario_clp_actual  DECIMAL,
    costo_unitario_usd_actual  DECIMAL,
    costo_teorico_total_clp    DECIMAL,
    costo_teorico_total_usd    DECIMAL,
    fuente_costo            VARCHAR,
    subreceta_sku           VARCHAR,
    subreceta_nombre        VARCHAR
) AS $func$
BEGIN
    RETURN QUERY
    WITH RECURSIVE explosion_bom AS (
        -- Nivel 1: hijos directos del PT
        SELECT
            rb.sku_padre AS sku_raiz,
            rb.sku_padre AS sku_nodo,
            rb.sku_hijo,
            CAST((rb.cantidad_neta * (1 + rb.porcentaje_merma)) AS DECIMAL(20,6)) AS cantidad_acumulada,
            -- Si el hijo directo es Sub-receta, lo registramos; si es Insumo directo, NULL
            CASE WHEN m.tipo = 'Sub-receta' THEN rb.sku_hijo  ELSE NULL END AS subreceta_l1_sku,
            CASE WHEN m.tipo = 'Sub-receta' THEN m.nombre     ELSE NULL END AS subreceta_l1_nombre
        FROM recetas_bom rb
        JOIN maestro_skus m ON m.sku = rb.sku_hijo
        WHERE rb.sku_padre = p_sku

        UNION ALL

        -- Niveles 2+: heredan la sub-receta de nivel 1 del padre
        SELECT
            p.sku_raiz,
            h.sku_padre AS sku_nodo,
            h.sku_hijo,
            CAST((p.cantidad_acumulada * (h.cantidad_neta * (1 + h.porcentaje_merma))) AS DECIMAL(20,6)),
            p.subreceta_l1_sku,
            p.subreceta_l1_nombre
        FROM explosion_bom p
        JOIN recetas_bom h ON p.sku_hijo = h.sku_padre
    )
    SELECT
        e.sku_hijo                                                                        AS insumo_final,
        m.nombre                                                                          AS nombre_insumo,
        SUM(e.cantidad_acumulada)                                                         AS cantidad_requerida_base,
        SUM(e.cantidad_acumulada)                                                         AS cantidad_requerida_formato,
        COALESCE(c.costo_unitario_clp, 0)                                                AS costo_unitario_clp_actual,
        COALESCE(c.costo_unitario_usd, 0)                                                AS costo_unitario_usd_actual,
        CAST((SUM(e.cantidad_acumulada) * COALESCE(c.costo_unitario_clp, 0)) AS DECIMAL(20,6)) AS costo_teorico_total_clp,
        CAST((SUM(e.cantidad_acumulada) * COALESCE(c.costo_unitario_usd, 0)) AS DECIMAL(20,6)) AS costo_teorico_total_usd,
        CAST(COALESCE(c.fuente_costo, 'sin_precio') AS VARCHAR)                          AS fuente_costo,
        CAST(e.subreceta_l1_sku   AS VARCHAR)                                            AS subreceta_sku,
        CAST(e.subreceta_l1_nombre AS VARCHAR)                                           AS subreceta_nombre
    FROM explosion_bom e
    JOIN maestro_skus m ON e.sku_hijo = m.sku
    LEFT JOIN vista_ultimo_costo c ON e.sku_hijo = c.sku
    WHERE m.tipo = 'Insumo'
    GROUP BY e.sku_hijo, m.nombre,
             c.costo_unitario_clp, c.costo_unitario_usd, c.fuente_costo,
             e.subreceta_l1_sku, e.subreceta_l1_nombre;
END;
$func$ LANGUAGE plpgsql;
