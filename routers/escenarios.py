from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from typing import Dict, List, Optional
from routers.costos import _calcular_ley_rep

router_escenarios = APIRouter(prefix="/api/escenarios", tags=["Escenarios"])
router_simulacion = APIRouter(prefix="/api/rentabilidad", tags=["Simulación Rentabilidad"])


@router_simulacion.post("/simular", response_model=Dict)
def simular_rentabilidad(payload: Dict, db: Session = Depends(get_db)):
    """
    Calcula rentabilidad para UNA cadena con parámetros personalizados.
    """
    costo_base = float(payload.get("costo_base_clp", 0))
    peso_kg    = float(payload.get("peso_kg", 1))
    sku        = payload.get("sku", "")

    # Obtener parámetros globales
    param = dict(db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).fetchone()._mapping)

    _ley_row = db.execute(text("SELECT ley_rep_clp FROM ley_rep_skus WHERE sku = :sku LIMIT 1"), {"sku": sku}).fetchone()
    ley_rep     = float(_ley_row[0]) if _ley_row and _ley_row[0] else peso_kg * float(param["ley_rep_por_kilo"])
    disposicion = peso_kg * float(param["disposicion_por_kilo"])
    gtos_indirectos = costo_base * float(param["gastos_indirectos_porcentaje"])

    # Parámetros del cliente
    flete_kilo   = float(payload.get("flete_kilo", 0))
    pallet_kilo  = float(payload.get("pallet_kilo", 0))
    factor       = float(payload.get("factor", 1))
    descuento    = float(payload.get("descuento_max", 0))
    comision_pct = float(payload.get("comision_promedio", 0))
    plan_pct     = (float(payload.get("rapell", 0)) +
                    float(payload.get("fee", 0)) +
                    float(payload.get("marketing", 0)) +
                    float(payload.get("x_docking", 0)) +
                    float(payload.get("rebate", 0)) +
                    float(payload.get("rebate_centralizacion", 0)))

    flete  = peso_kg * flete_kilo
    pallet = peso_kg * pallet_kilo

    costo_parcial = costo_base + flete + pallet + ley_rep + disposicion + gtos_indirectos
    p_lista = costo_parcial * factor
    p_final = p_lista * (1 - descuento)

    comision_monto        = p_final * comision_pct
    plan_comercial_monto  = p_final * plan_pct
    costo_total           = costo_parcial + comision_monto + plan_comercial_monto
    utilidad              = p_final - costo_total

    mg_final = (utilidad / p_final * 100) if p_final > 0 else 0
    mg_lista = ((p_lista - costo_total) / p_lista * 100) if p_lista > 0 else 0

    nnr  = p_final - plan_comercial_monto - comision_monto
    cm1  = nnr - costo_base - ley_rep - disposicion - flete - pallet
    cm2  = cm1 - gtos_indirectos
    cm1_pct = (cm1 / nnr * 100) if nnr > 0 else 0
    cm2_pct = (cm2 / nnr * 100) if nnr > 0 else 0

    precio_piso = costo_total

    return {
        "precio_lista":          round(p_lista, 2),
        "precio_final":          round(p_final, 2),
        "costo_parcial":         round(costo_parcial, 2),
        "comision_monto":        round(comision_monto, 2),
        "plan_comercial_monto":  round(plan_comercial_monto, 2),
        "costo_total":           round(costo_total, 2),
        "cm1":                   round(cm1, 2),
        "cm1_pct":               round(cm1_pct, 2),
        "cm2":                   round(cm2, 2),
        "cm2_pct":               round(cm2_pct, 2),
        "mg_lista_porc":         round(mg_lista, 2),
        "mg_final_porc":         round(mg_final, 2),
        "utilidad":              round(utilidad, 2),
        "precio_piso":           round(precio_piso, 2),
        "ley_rep":               round(ley_rep, 2),
        "disposicion":           round(disposicion, 2),
        "gtos_indirectos":       round(gtos_indirectos, 2),
        "flete":                 round(flete, 2),
        "pallet":                round(pallet, 2),
    }


@router_simulacion.post("/simular-masivo", response_model=List[Dict])
def simular_rentabilidad_masivo(payload: Dict, db: Session = Depends(get_db)):
    """
    Simula rentabilidad para TODOS los PT de una familia/subfamilia
    con condiciones personalizadas, comparando vs. condiciones actuales de una cadena.
    """
    familia    = payload.get("familia", "")
    subfamilia = payload.get("subfamilia", "")
    cadena_id  = payload.get("cadena_id")

    # Parámetros globales
    param_row = db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).mappings().first()
    param = dict(param_row) if param_row else {}
    merma    = float(param.get("merma_global_factor", 1.0))
    disp_kg  = float(param.get("disposicion_por_kilo", 0))
    gtos_pct = float(param.get("gastos_indirectos_porcentaje", 0))

    # Condiciones actuales de la cadena (para columna "Actual")
    c_orig: Dict = {}
    if cadena_id:
        row = db.execute(text("SELECT * FROM clientes_condiciones WHERE id = :id"), {"id": cadena_id}).mappings().first()
        if row:
            c_orig = dict(row)

    # Condiciones simuladas (del payload — pueden diferir de c_orig)
    def _float(key: str, fallback_key: Optional[str] = None) -> float:
        v = payload.get(key)
        if v is not None:
            return float(v)
        if fallback_key:
            return float(c_orig.get(fallback_key, 0))
        return float(c_orig.get(key, 0))

    sim_factor       = _float("factor")
    sim_desc         = _float("descuento_max")
    sim_comision     = _float("comision_promedio")
    sim_plan         = (_float("rapell") + _float("fee") + _float("marketing") +
                        _float("x_docking") + _float("rebate") + _float("rebate_centralizacion"))
    sim_flete_agua   = _float("flete_agua_kilo")
    sim_flete_otros  = _float("flete_otros_kilo")
    sim_pallet_agua  = _float("pallet_agua_kilo")
    sim_pallet_otros = _float("pallet_otros_kilo")

    # Condiciones actuales (de c_orig)
    act_factor   = float(c_orig.get("factor", 1))
    act_desc     = float(c_orig.get("descuento_max", 0))
    act_comision = float(c_orig.get("comision_promedio", 0))
    act_plan     = (float(c_orig.get("rapell", 0)) + float(c_orig.get("fee", 0)) +
                    float(c_orig.get("marketing", 0)) + float(c_orig.get("x_docking", 0)) +
                    float(c_orig.get("rebate", 0)) + float(c_orig.get("rebate_centralizacion", 0)))

    # Obtener PT por familia/subfamilia
    where = ["m.tipo = 'Producto Terminado'"]
    params_q: Dict = {}
    if familia:
        where.append("m.familia = :familia")
        params_q["familia"] = familia
    if subfamilia:
        where.append("m.subfamilia = :subfamilia")
        params_q["subfamilia"] = subfamilia

    skus_rows = db.execute(text(f"""
        SELECT m.sku, m.nombre, m.familia, m.subfamilia, m.unidad_medida
        FROM maestro_skus m
        WHERE {' AND '.join(where)}
        ORDER BY m.familia, m.subfamilia, m.nombre
    """), params_q).fetchall()

    FAMILIAS_BASE_AGUA = {"PINTURAS AL AGUA", "LATEX"}

    resultados = []
    for row in skus_rows:
        sku, nombre, fam, subfam, unidad = row[0], row[1], row[2], row[3], row[4]
        try:
            bom = db.execute(text("SELECT * FROM explotar_costo_sku(:sku)"), {"sku": sku}).fetchall()
            if not bom:
                resultados.append({"sku": sku, "nombre": nombre, "familia": fam,
                                    "subfamilia": subfam, "tiene_bom": False,
                                    "insumos_sin_precio": 0, "actual": None, "simulado": None})
                continue

            sin_precio = sum(1 for r in bom if r[8] == "sin_precio")
            costo_bom  = sum(float(r[6]) for r in bom)
            costo_base = round(costo_bom * merma, 4)

            fc_row = db.execute(text("""
                SELECT kilo_neto FROM factores_conversion
                WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1
            """), {"sku": sku, "unidad": unidad or ""}).mappings().first()
            peso_kg = float(fc_row["kilo_neto"]) if fc_row and fc_row["kilo_neto"] else 0.0

            ley_rep     = _calcular_ley_rep(sku, unidad or "", peso_kg, param, db)
            disposicion = round(peso_kg * disp_kg, 2)
            gtos_ind    = round(costo_base * gtos_pct, 2)
            gastos_fijos = ley_rep + disposicion + gtos_ind

            es_agua = (fam or "").upper() in FAMILIAS_BASE_AGUA

            def _calcular(factor: float, desc: float, comision: float, plan: float,
                          flete_kilo: float, pallet_kilo: float) -> Dict:
                flete  = round(peso_kg * flete_kilo, 2)
                pallet = round(peso_kg * pallet_kilo, 2)
                costo_parcial = round(costo_base + flete + pallet + gastos_fijos, 2)
                p_lista = round(costo_parcial * factor, 2)
                p_final = round(p_lista * (1 - desc), 2)
                com_monto  = round(p_final * comision, 2)
                plan_monto = round(p_final * plan, 2)
                costo_total = round(costo_parcial + com_monto + plan_monto, 2)
                utilidad = round(p_final - costo_total, 2)
                mg_final = round((utilidad / p_final * 100) if p_final > 0 else 0, 2)
                nnr  = p_final - plan_monto - com_monto
                cm2  = round(nnr - costo_base - gastos_fijos, 2)
                cm2_pct = round((cm2 / nnr * 100) if nnr > 0 else 0, 2)
                return {"costo_bom": round(costo_bom, 2), "costo_parcial": costo_parcial,
                        "precio_lista": p_lista, "precio_final": p_final,
                        "mg_final_pct": mg_final, "cm2_pct": cm2_pct, "utilidad": utilidad,
                        "flete": flete, "pallet": pallet}

            actual = _calcular(
                act_factor, act_desc, act_comision, act_plan,
                float(c_orig.get("flete_agua_kilo" if es_agua else "flete_otros_kilo", 0)),
                float(c_orig.get("pallet_agua_kilo" if es_agua else "pallet_otros_kilo", 0)),
            )
            simulado = _calcular(
                sim_factor, sim_desc, sim_comision, sim_plan,
                sim_flete_agua if es_agua else sim_flete_otros,
                sim_pallet_agua if es_agua else sim_pallet_otros,
            )

            resultados.append({
                "sku": sku, "nombre": nombre, "familia": fam, "subfamilia": subfam,
                "tiene_bom": True, "insumos_sin_precio": sin_precio,
                "actual": actual, "simulado": simulado,
            })
        except Exception:
            resultados.append({"sku": sku, "nombre": nombre, "familia": fam,
                                "subfamilia": subfam, "tiene_bom": False,
                                "insumos_sin_precio": 0, "actual": None, "simulado": None})

    return resultados


# ── Escenarios guardados ────────────────────────────────────────

@router_escenarios.get("/", response_model=List[Dict])
def listar_escenarios(sku: str = "", db: Session = Depends(get_db)):
    """Lista escenarios guardados, opcionalmente filtrados por SKU."""
    if sku:
        rows = db.execute(text(
            "SELECT * FROM escenarios_rentabilidad WHERE sku = :sku ORDER BY created_at DESC"
        ), {"sku": sku}).fetchall()
    else:
        rows = db.execute(text(
            "SELECT * FROM escenarios_rentabilidad ORDER BY created_at DESC LIMIT 50"
        )).fetchall()
    return [dict(r._mapping) for r in rows]


@router_escenarios.post("/", response_model=Dict)
def crear_escenario(payload: Dict, db: Session = Depends(get_db)):
    """Guarda un escenario de rentabilidad simulado."""
    result = db.execute(text("""
        INSERT INTO escenarios_rentabilidad
            (nombre, sku, nombre_sku, cliente_id, cliente,
             factor, descuento_max, comision_promedio,
             rapell, fee, marketing, x_docking, rebate, rebate_centralizacion,
             flete_kilo, pallet_kilo,
             precio_lista, precio_final, cm2_pct, utilidad)
        VALUES
            (:nombre, :sku, :nombre_sku, :cliente_id, :cliente,
             :factor, :descuento_max, :comision_promedio,
             :rapell, :fee, :marketing, :x_docking, :rebate, :rebate_centralizacion,
             :flete_kilo, :pallet_kilo,
             :precio_lista, :precio_final, :cm2_pct, :utilidad)
        RETURNING id, nombre, created_at
    """), {
        "nombre":               payload.get("nombre", "Sin nombre"),
        "sku":                  payload.get("sku", ""),
        "nombre_sku":           payload.get("nombre_sku", ""),
        "cliente_id":           payload.get("cliente_id"),
        "cliente":              payload.get("cliente", ""),
        "factor":               float(payload.get("factor", 1)),
        "descuento_max":        float(payload.get("descuento_max", 0)),
        "comision_promedio":    float(payload.get("comision_promedio", 0)),
        "rapell":               float(payload.get("rapell", 0)),
        "fee":                  float(payload.get("fee", 0)),
        "marketing":            float(payload.get("marketing", 0)),
        "x_docking":            float(payload.get("x_docking", 0)),
        "rebate":               float(payload.get("rebate", 0)),
        "rebate_centralizacion":float(payload.get("rebate_centralizacion", 0)),
        "flete_kilo":           float(payload.get("flete_kilo", 0)),
        "pallet_kilo":          float(payload.get("pallet_kilo", 0)),
        "precio_lista":         float(payload.get("precio_lista", 0)),
        "precio_final":         float(payload.get("precio_final", 0)),
        "cm2_pct":              float(payload.get("cm2_pct", 0)),
        "utilidad":             float(payload.get("utilidad", 0)),
    })
    db.commit()
    row = result.fetchone()
    return {"status": "ok", "id": row[0], "nombre": row[1]}


@router_escenarios.delete("/{id}")
def eliminar_escenario(id: int, db: Session = Depends(get_db)):
    result = db.execute(text("DELETE FROM escenarios_rentabilidad WHERE id = :id"), {"id": id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Escenario {id} no encontrado.")
    return {"status": "ok", "id": id}
