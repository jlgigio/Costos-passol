-- 1. Maestro de SKUs
CREATE TABLE IF NOT EXISTS maestro_skus (
    sku VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) CHECK (tipo IN ('Insumo', 'Sub-receta', 'Producto Terminado')),
    unidad_medida VARCHAR(20) NOT NULL,
    familia VARCHAR(100),
    subfamilia VARCHAR(100),
    densidad NUMERIC(10,6)
);

-- 2. Tabla de Recetas (Bill of Materials - BOM)
CREATE TABLE IF NOT EXISTS recetas_bom (
    id SERIAL PRIMARY KEY,
    sku_padre VARCHAR(50) REFERENCES maestro_skus(sku),
    sku_hijo VARCHAR(50) REFERENCES maestro_skus(sku),
    cantidad_neta DECIMAL(15, 6) NOT NULL,
    porcentaje_merma DECIMAL(5, 4) NOT NULL DEFAULT 0.0000,
    CONSTRAINT unique_bom_relation UNIQUE (sku_padre, sku_hijo),
    CONSTRAINT chk_no_self_reference CHECK (sku_padre <> sku_hijo)
);

-- 3. Tabla de Tipos de Cambio (Dólar y Euro Histórico)
CREATE TABLE IF NOT EXISTS tipos_cambio (
    fecha DATE PRIMARY KEY,
    valor_usd DECIMAL(10, 2) NOT NULL,
    valor_eur DECIMAL(10, 2)
);

-- 4. Tabla de Costos Históricos (Compras Locales e IMPO)
CREATE TABLE IF NOT EXISTS costos_historicos (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) REFERENCES maestro_skus(sku),
    fecha_compra DATE NOT NULL DEFAULT CURRENT_DATE,
    costo_unitario DECIMAL(15, 6) NOT NULL,
    moneda VARCHAR(5) NOT NULL DEFAULT 'CLP' CHECK (moneda IN ('CLP', 'USD')),
    proveedor VARCHAR(255)
);

-- 5. Costos Manuales (fallback para insumos sin historial de compras)
-- Tiene menor prioridad que costos_historicos.
-- Usado para packaging, aditivos con contrato aparte, o ítems nuevos.
CREATE TABLE IF NOT EXISTS costos_manuales (
    sku VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
    costo_unitario_clp DECIMAL(15, 6) NOT NULL,
    fecha_actualizacion DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario VARCHAR(100),
    notas TEXT
);

-- 6. Tabla de Precios y Márgenes
CREATE TABLE IF NOT EXISTS precios_margenes (
    sku VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
    precio_venta DECIMAL(15, 6) NOT NULL,
    impuestos DECIMAL(5, 4) NOT NULL DEFAULT 0.0000,
    canal_venta VARCHAR(100)
);

-- 6. Tabla de Factores de Conversión (Para Formatos de Productos Terminados)
-- Columnas reales: sku, unidad, litros, kilo_neto, kilo_bruto
CREATE TABLE IF NOT EXISTS factores_conversion (
    sku VARCHAR(50) REFERENCES maestro_skus(sku),
    unidad VARCHAR(50),
    litros NUMERIC(15, 6),
    kilo_neto NUMERIC(15, 6),
    kilo_bruto NUMERIC(15, 6),
    PRIMARY KEY (sku, unidad)
);

-- Trigger y Función para Evitar Bucles en el Árbol BOM
CREATE OR REPLACE FUNCTION check_bom_cycle() RETURNS TRIGGER AS $$
DECLARE
    cycle_detected BOOLEAN;
BEGIN
    WITH RECURSIVE search_graph AS (
        SELECT sku_hijo FROM recetas_bom WHERE sku_padre = NEW.sku_hijo
        UNION ALL
        SELECT r.sku_hijo FROM recetas_bom r
        INNER JOIN search_graph sg ON r.sku_padre = sg.sku_hijo
    )
    SELECT EXISTS(SELECT 1 FROM search_graph WHERE sku_hijo = NEW.sku_padre) INTO cycle_detected;

    IF cycle_detected THEN
        RAISE EXCEPTION '¡Bucle detectado! El SKU % no puede incluir a % porque generaría una recursión infinita.', NEW.sku_padre, NEW.sku_hijo;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_bom_cycle ON recetas_bom;
CREATE TRIGGER trg_check_bom_cycle
BEFORE INSERT OR UPDATE ON recetas_bom
FOR EACH ROW EXECUTE FUNCTION check_bom_cycle();

-- Vista de LPP (Último Precio de Compra con Fallback a Costos Manuales)
-- Prioridad: costos_historicos (compra real) > costos_manuales (ingresado manualmente)
-- Todos los costos se almacenan y devuelven en CLP.
-- fuente_costo indica el origen: 'compra' o 'manual'
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
    ORDER BY ch.sku, ch.costo_unitario DESC   -- ante empate de fecha, tomar el mayor
)
SELECT
    COALESCE(c.sku, m.sku)                          AS sku,
    COALESCE(c.fecha_compra, m.fecha_actualizacion) AS fecha_compra,
    COALESCE(c.costo_unitario, m.costo_unitario_clp) AS costo_unitario_clp,
    CASE
        WHEN (SELECT valor_usd FROM tipos_cambio ORDER BY fecha DESC LIMIT 1) > 0
        THEN COALESCE(c.costo_unitario, m.costo_unitario_clp)
             / (SELECT valor_usd FROM tipos_cambio ORDER BY fecha DESC LIMIT 1)
        ELSE 0
    END AS costo_unitario_usd,
    CASE WHEN c.sku IS NOT NULL THEN CAST('compra' AS VARCHAR) ELSE CAST('manual' AS VARCHAR) END AS fuente_costo
FROM UltimaCompra c
FULL OUTER JOIN costos_manuales m ON c.sku = m.sku;

-- Motor Principal: Función Recursiva para Explotar Costos de un SKU
-- El BOM ya viene normalizado por lote_base desde el ERP, por lo que las cantidades
-- acumuladas representan directamente la cantidad por 1 unidad del PT.
-- Cada insumo hoja se valoriza al último precio de compra (vista_ultimo_costo).
CREATE OR REPLACE FUNCTION explotar_costo_sku(p_sku VARCHAR)
RETURNS TABLE (
    insumo_final VARCHAR,
    nombre_insumo VARCHAR,
    cantidad_requerida_base DECIMAL,
    cantidad_requerida_formato DECIMAL,
    costo_unitario_clp_actual DECIMAL,
    costo_unitario_usd_actual DECIMAL,
    costo_teorico_total_clp DECIMAL,
    costo_teorico_total_usd DECIMAL,
    fuente_costo VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE explosion_bom AS (
        -- Nivel 0 (Raíz): hijos directos del PT con merma aplicada
        SELECT
            sku_padre AS sku_raiz,
            sku_padre AS sku_nodo,
            sku_hijo,
            CAST((cantidad_neta * (1 + porcentaje_merma)) AS DECIMAL(20,6)) AS cantidad_acumulada
        FROM recetas_bom
        WHERE sku_padre = p_sku

        UNION ALL

        -- Niveles N (Sub-procesos y Sub-recetas): multiplicación acumulativa de cantidades
        SELECT
            p.sku_raiz,
            h.sku_padre AS sku_nodo,
            h.sku_hijo,
            CAST((p.cantidad_acumulada * (h.cantidad_neta * (1 + h.porcentaje_merma))) AS DECIMAL(20,6))
        FROM explosion_bom p
        JOIN recetas_bom h ON p.sku_hijo = h.sku_padre
    )
    -- Resultado final: solo las hojas del árbol (Insumos sin sub-receta propia)
    SELECT
        e.sku_hijo AS insumo_final,
        m.nombre AS nombre_insumo,
        SUM(e.cantidad_acumulada)                    AS cantidad_requerida_base,
        SUM(e.cantidad_acumulada)                    AS cantidad_requerida_formato,
        COALESCE(c.costo_unitario_clp, 0)            AS costo_unitario_clp_actual,
        COALESCE(c.costo_unitario_usd, 0)            AS costo_unitario_usd_actual,
        CAST((SUM(e.cantidad_acumulada) * COALESCE(c.costo_unitario_clp, 0)) AS DECIMAL(20, 6)) AS costo_teorico_total_clp,
        CAST((SUM(e.cantidad_acumulada) * COALESCE(c.costo_unitario_usd, 0)) AS DECIMAL(20, 6)) AS costo_teorico_total_usd,
        COALESCE(c.fuente_costo, 'sin_precio')       AS fuente_costo
    FROM explosion_bom e
    JOIN maestro_skus m ON e.sku_hijo = m.sku
    LEFT JOIN vista_ultimo_costo c ON e.sku_hijo = c.sku
    WHERE m.tipo = 'Insumo'
    GROUP BY e.sku_hijo, m.nombre, c.costo_unitario_clp, c.costo_unitario_usd, c.fuente_costo;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLAS COMERCIALES (creadas mediante migraciones, incluidas aquí para
-- que init_db_directo.py reproduzca el esquema completo desde cero)
-- ─────────────────────────────────────────────────────────────────────────────

-- 7. Parámetros Comerciales Globales (fila única id=1)
CREATE TABLE IF NOT EXISTS parametros_comerciales (
    id                           SERIAL PRIMARY KEY,
    ley_rep_por_kilo             NUMERIC(12, 6) NOT NULL DEFAULT 0,
    disposicion_por_kilo         NUMERIC(12, 6) NOT NULL DEFAULT 0,
    gastos_indirectos_porcentaje NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    comision_porcentaje          NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    merma_global_factor          NUMERIC(8, 6)  NOT NULL DEFAULT 1,
    costo_flete_base_kilo        NUMERIC(12, 6) NOT NULL DEFAULT 0,
    costo_pallet_base_kilo       NUMERIC(12, 6) NOT NULL DEFAULT 0,
    tipo_cambio_usd              NUMERIC(12, 2) NOT NULL DEFAULT 950,
    tipo_cambio_eur              NUMERIC(12, 2)          DEFAULT 0,
    valor_uf                     NUMERIC(12, 2)          DEFAULT 37000
);
INSERT INTO parametros_comerciales (id) VALUES (1) ON CONFLICT DO NOTHING;

-- 8. Condiciones Comerciales por Cliente (Cadenas)
CREATE TABLE IF NOT EXISTS clientes_condiciones (
    id                    SERIAL PRIMARY KEY,
    cliente               VARCHAR(150) NOT NULL,
    factor                NUMERIC(8, 6)  NOT NULL DEFAULT 1,
    descuento_max         NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    comision_promedio     NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    rapell                NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    fee                   NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    marketing             NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    x_docking             NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    rebate                NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    rebate_centralizacion NUMERIC(8, 6)  NOT NULL DEFAULT 0,
    flete_por_kilo        NUMERIC(12, 6) NOT NULL DEFAULT 0,
    flete_agua_kilo       NUMERIC(12, 6) NOT NULL DEFAULT 0,
    flete_otros_kilo      NUMERIC(12, 6) NOT NULL DEFAULT 0,
    pallet_agua_kilo      NUMERIC(12, 6) NOT NULL DEFAULT 0,
    pallet_otros_kilo     NUMERIC(12, 6) NOT NULL DEFAULT 0
);

-- 9. Ley REP por Formato de Envase
CREATE TABLE IF NOT EXISTS ley_rep_formatos (
    id             SERIAL PRIMARY KEY,
    formato        VARCHAR(50) UNIQUE NOT NULL,
    uf_por_formato NUMERIC(10, 6) NOT NULL DEFAULT 0,
    updated_at     TIMESTAMP DEFAULT NOW()
);

-- 10. Ley REP por SKU específico (override individual)
CREATE TABLE IF NOT EXISTS ley_rep_skus (
    sku         VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
    ley_rep_clp NUMERIC(15, 2) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 11. Ficha de Condiciones por Producto Terminado
CREATE TABLE IF NOT EXISTS condiciones_producto (
    sku                   VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
    precio_venta_sugerido NUMERIC(15, 2),
    precio_piso           NUMERIC(15, 2),
    margen_objetivo_pct   NUMERIC(5, 2),
    clasificacion         VARCHAR(100),
    notas                 TEXT,
    updated_at            TIMESTAMP DEFAULT NOW()
);

-- 12. Escenarios de Rentabilidad Guardados
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
