-- Historial de escenarios de simulación de recetas (What-If)
CREATE TABLE IF NOT EXISTS escenarios_receta (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL,
    sku             VARCHAR(50),
    nombre_sku      VARCHAR(255),
    modo            VARCHAR(20) DEFAULT 'existente',  -- 'existente' | 'nueva'
    costo_original_clp  NUMERIC(15, 2),
    costo_simulado_clp  NUMERIC(15, 2),
    variacion_pct       NUMERIC(8, 2),
    insumos_json        JSONB,   -- snapshot de simInputs al momento de guardar
    created_at      TIMESTAMP DEFAULT NOW()
);
