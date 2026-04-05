import re
import logging
import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Set

logger = logging.getLogger("passol.simulador")

GALON_L = 3.785411784


def detectar_bom_circular(sku_padre: str, sku_hijo: str, db: Session) -> None:
    """
    Verifica que agregar sku_hijo a la receta de sku_padre no crea un ciclo.
    Lanza HTTPException 400 si detecta circularidad.

    Algoritmo: DFS desde sku_hijo — si en algún momento llegamos a sku_padre,
    hay un ciclo (ej: A → B → C → A).
    """
    visitados: Set[str] = set()

    def dfs(sku_actual: str) -> bool:
        if sku_actual == sku_padre:
            return True
        if sku_actual in visitados:
            return False
        visitados.add(sku_actual)
        hijos = db.execute(
            text("SELECT sku_hijo FROM recetas_bom WHERE sku_padre = :p"),
            {"p": sku_actual},
        ).fetchall()
        return any(dfs(str(h[0])) for h in hijos)

    if dfs(sku_hijo):
        logger.warning(
            f"BOM circular detectado: agregar '{sku_hijo}' a '{sku_padre}' crearía un ciclo."
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"No se puede agregar '{sku_hijo}' a la receta de '{sku_padre}': "
                "se detectó una referencia circular en la BOM."
            ),
        )


def _calcular_ley_rep(sku: str, formato: str, peso_kg: float, param_dict: dict, db: Session) -> float:
    """
    Jerarquía de Ley REP (de mayor a menor especificidad):
      1. ley_rep_skus          — override por SKU individual (CLP directo)
      2. ley_rep_formatos      — tabla por formato de envase (UF × valor_uf)
      3. ley_rep_por_kilo      — parámetro global (CLP/kg × peso_kg)
    """
    # 1. Por SKU
    row = db.execute(
        text("SELECT ley_rep_clp FROM ley_rep_skus WHERE sku = :sku LIMIT 1"),
        {"sku": sku}
    ).fetchone()
    if row and row[0]:
        return float(row[0])

    # 2. Por formato de envase
    row = db.execute(text("""
        SELECT lrf.uf_por_formato * pc.valor_uf AS ley_rep_clp
        FROM ley_rep_formatos lrf
        CROSS JOIN parametros_comerciales pc
        WHERE lrf.formato ILIKE :formato AND pc.id = 1
        LIMIT 1
    """), {"formato": formato or ""}).fetchone()
    if row and row[0]:
        return float(row[0])

    # 3. Global por kilo
    return peso_kg * float(param_dict.get('ley_rep_por_kilo', 0))

# Familias de envase/packaging → van a "Costo Insumos"
FAMILIAS_PACKAGING = {
    'ENVASES', 'TAPAS', 'CAJAS', 'ETIQUETAS',
    'OTROS INSUMOS ENVASADO', 'PALLET', 'COMPLEMENTOS PINTURAS'
}

# Familias que califican como "Pintura Base Agua" para el flete diferenciado
FAMILIAS_BASE_AGUA = {'PINTURAS AL AGUA', 'LATEX'}

def extraer_litros_formato(nombre: str, unidad_medida: str = "") -> float:
    """
    Extrae el volumen en litros del formato unitario desde el nombre del producto.
    Cubre los patrones más comunes en nomenclatura Passol:
      1/4 GAL → 0.946 L | 1 GAL → 3.785 L | 4 GAL → 15.14 L
      10 LT → 10 L | 250 ML → 0.25 L
    """
    texto = (nombre + " " + unidad_medida).upper()

    # Fracción de galón: "1/4 GAL" → 0.946 L
    m = re.search(r'(\d+)/(\d+)\s*GAL', texto)
    if m:
        return round((int(m.group(1)) / int(m.group(2))) * GALON_L, 4)

    # Múltiplos enteros de galón: "1 GAL", "4 GAL", "5 GAL"
    m = re.search(r'(\d+)\s*GAL', texto)
    if m:
        return round(int(m.group(1)) * GALON_L, 4)

    # Litros explícitos: "10 LT", "20 LT"
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*LT\b', texto)
    if m:
        return float(m.group(1).replace(',', '.'))

    # Mililitros: "250 ML"
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*ML\b', texto)
    if m:
        return round(float(m.group(1).replace(',', '.')) / 1000.0, 4)

    return 0.0

def calcular_rentabilidad_clientes(costo_base_mp: float, peso_kg: float, db: Session, familia_producto: str = '', sku: str = '', formato: str = '') -> List[Dict]:
    param_query = text("SELECT * FROM parametros_comerciales WHERE id = 1")
    param_dict = dict(db.execute(param_query).fetchone()._mapping)

    ley_rep = _calcular_ley_rep(sku, formato, peso_kg, param_dict, db)
    disposicion = peso_kg * float(param_dict['disposicion_por_kilo'])
    gtos_indirectos = costo_base_mp * float(param_dict['gastos_indirectos_porcentaje'])

    es_base_agua = familia_producto.upper() in FAMILIAS_BASE_AGUA

    clientes_query = text("SELECT * FROM clientes_condiciones ORDER BY id")
    clientes = db.execute(clientes_query).fetchall()

    rentabilidades = []

    for row in clientes:
        c = dict(row._mapping)

        if es_base_agua:
            flete_kilo  = float(c.get('flete_agua_kilo')  or c.get('flete_por_kilo') or 0)
            pallet_kilo = float(c.get('pallet_agua_kilo') or 0)
        else:
            flete_kilo  = float(c.get('flete_otros_kilo')  or c.get('flete_por_kilo') or 0)
            pallet_kilo = float(c.get('pallet_otros_kilo') or 0)
        flete  = peso_kg * flete_kilo
        pallet = peso_kg * pallet_kilo
        costo_parcial = costo_base_mp + flete + pallet + ley_rep + disposicion + gtos_indirectos
        
        factor = float(c['factor'])
        p_lista = costo_parcial * factor
        
        desc_max = float(c['descuento_max'])
        p_final = p_lista * (1.0 - desc_max)
        
        comision_promedio = float(c['comision_promedio'])
        plan_comercial_pct = float(c['rapell']) + float(c['fee']) + float(c['marketing']) + float(c['x_docking']) + float(c['rebate']) + float(c['rebate_centralizacion'])
        
        comision_monto = p_final * comision_promedio
        plan_comercial_monto = p_final * plan_comercial_pct
        
        costo_total = costo_parcial + comision_monto + plan_comercial_monto
        utilidad = p_final - costo_total
        
        mg_final_porc = (utilidad / p_final * 100) if p_final > 0 else 0
        mg_lista_porc = ((p_lista - costo_total) / p_lista * 100) if p_lista > 0 else 0
        
        rentabilidades.append({
            "cliente": c["cliente"],
            "flete_clp": round(flete, 2),
            "pallet_clp": round(pallet, 2),
            "costo_parcial": round(costo_parcial, 2),
            "comision_monto": round(comision_monto, 2),
            "plan_comercial_monto": round(plan_comercial_monto, 2),
            "costo_total": round(costo_total, 2),
            "precio_lista_envase": round(p_lista, 2),
            "precio_final_envase": round(p_final, 2),
            "mg_lista_porc": round(mg_lista_porc, 2),
            "mg_final_porc": round(mg_final_porc, 2),
            "utilidad_final": round(utilidad, 2)
        })
        
    return rentabilidades

def obtener_explosion(sku: str, db: Session):
    # 1. Obtener la explosión base (Costo MP + Insumos)
    query = text("SELECT * FROM explotar_costo_sku(:sku)")
    result = db.execute(query, {"sku": sku}).fetchall()
    
    # 2. Obtener parámetros comerciales (Globales)
    param_query = text("SELECT * FROM parametros_comerciales WHERE id = 1")
    param_dict = dict(db.execute(param_query).fetchone()._mapping)
    
    # 3. Obtener formato, densidad, familia y nombre del producto desde maestro_skus
    maestro_query = text("SELECT nombre, unidad_medida, densidad, familia FROM maestro_skus WHERE sku = :sku LIMIT 1")
    maestro_row = db.execute(maestro_query, {"sku": sku}).fetchone()
    nombre_pt  = str(maestro_row.nombre).strip()       if maestro_row else ""
    formato    = str(maestro_row.unidad_medida).strip() if maestro_row else ""
    densidad_bd = float(maestro_row.densidad) if maestro_row and maestro_row.densidad is not None else 0.0
    familia_pt  = str(maestro_row.familia or '').strip().upper() if maestro_row else ""

    # Litros y kilos del formato: primero desde factores_conversion (hoja factor del Excel maestro)
    factor_query = text("""
        SELECT litros, kilo_neto FROM factores_conversion
        WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1
    """)
    factor_row = db.execute(factor_query, {"sku": sku, "unidad": formato}).fetchone()
    if factor_row and factor_row.litros:
        litros_formato = float(factor_row.litros)
        kilos_formato  = float(factor_row.kilo_neto) if factor_row.kilo_neto else round(densidad_bd * litros_formato, 4)
    else:
        # Fallback: parsear el nombre del producto
        litros_formato = extraer_litros_formato(nombre_pt, formato)
        kilos_formato  = 0.0  # se calcula abajo con densidad

    if not result:
        return {
            "sku": sku, "costo_total_actual_clp": 0.0, "costo_total_actual_usd": 0.0,
            "peso_kilos": 0.0, "flete_clp": 0.0, "pallet_clp": 0.0, "ley_rep_clp": 0.0, "disposicion_clp": 0.0, "gtos_indirectos_clp": 0.0, "costo_final_clp": 0.0,
            "detalle_insumos": []
        }
    
    insumos = []
    costo_total_clp = 0.0
    costo_total_usd = 0.0
    for row in result:
        costo_total_clp += float(row.costo_teorico_total_clp)
        costo_total_usd += float(row.costo_teorico_total_usd)
        insumos.append({
            "insumo_final": row.insumo_final,
            "nombre_insumo": row.nombre_insumo,
            "cantidad_requerida_base": float(row.cantidad_requerida_base),
            "cantidad_requerida_formato": float(row.cantidad_requerida_formato),
            "costo_unitario_clp_actual": float(row.costo_unitario_clp_actual),
            "costo_unitario_usd_actual": float(row.costo_unitario_usd_actual),
            "costo_teorico_total_clp": float(row.costo_teorico_total_clp),
            "costo_teorico_total_usd": float(row.costo_teorico_total_usd),
            "fuente_costo": getattr(row, 'fuente_costo', None),
            "subreceta_sku": getattr(row, 'subreceta_sku', None),
            "subreceta_nombre": getattr(row, 'subreceta_nombre', None),
        })
        
    # 4. Separar costo MP (materias primas) vs costo Insumos (packaging/envase)
    sku_list = [i['insumo_final'] for i in insumos]
    familia_rows = db.execute(
        text("SELECT sku, familia FROM maestro_skus WHERE sku = ANY(:skus)"),
        {"skus": sku_list}
    ).fetchall()
    familia_map = {r.sku: (r.familia or '').upper() for r in familia_rows}

    costo_mp_clp       = 0.0
    costo_insumos_clp  = 0.0
    for ins in insumos:
        fam = familia_map.get(ins['insumo_final'], '')
        ins['familia'] = fam
        if fam in FAMILIAS_PACKAGING:
            costo_insumos_clp += ins['costo_teorico_total_clp']
        else:
            costo_mp_clp += ins['costo_teorico_total_clp']

    # 5. Si kilos_formato no vino de factores_conversion, derivar de densidad × litros
    densidad = densidad_bd
    if kilos_formato == 0.0 and densidad > 0 and litros_formato > 0:
        kilos_formato = round(densidad * litros_formato, 4)
    peso_kg = kilos_formato if kilos_formato > 0 else 1.0

    # Aplicar merma global al costo de materias primas
    merma_factor = float(param_dict.get('merma_global_factor', 1.0))
    costo_total_con_merma = round(costo_total_clp * merma_factor, 2)

    # 5. Cálculo rentabilidades (recalcular flete/ley_rep con peso correcto)
    # Pallet y flete base: usar tarifas del canal Terreno (referencia base)
    terreno_row = db.execute(text("""
        SELECT flete_agua_kilo, flete_otros_kilo, pallet_agua_kilo, pallet_otros_kilo
        FROM clientes_condiciones WHERE cliente ILIKE 'Terreno' LIMIT 1
    """)).mappings().first()
    es_agua = familia_pt in FAMILIAS_BASE_AGUA
    if terreno_row:
        flete_kilo_ref  = float(terreno_row['flete_agua_kilo']  if es_agua else terreno_row['flete_otros_kilo'])
        pallet_kilo_ref = float(terreno_row['pallet_agua_kilo'] if es_agua else terreno_row['pallet_otros_kilo'])
    else:
        flete_kilo_ref  = float(param_dict['costo_flete_base_kilo'])
        pallet_kilo_ref = float(param_dict.get('costo_pallet_base_kilo', 0))
    flete = peso_kg * flete_kilo_ref
    pallet = peso_kg * pallet_kilo_ref
    ley_rep = _calcular_ley_rep(sku, formato, peso_kg, param_dict, db)
    disposicion = peso_kg * float(param_dict['disposicion_por_kilo'])
    gtos_indirectos = costo_total_con_merma * float(param_dict['gastos_indirectos_porcentaje'])
    costo_final_clp = costo_total_con_merma + flete + pallet + ley_rep + disposicion + gtos_indirectos

    rentabilidad_clientes = calcular_rentabilidad_clientes(costo_total_con_merma, peso_kg, db, familia_pt, sku, formato)

    costo_por_kilo = round(costo_final_clp / kilos_formato, 2) if kilos_formato > 0 else 0.0
    costo_por_litro = round(costo_final_clp / litros_formato, 2) if litros_formato > 0 else 0.0

    # Datos crudos de clientes para el simulador de rentabilidad
    clientes_raw = db.execute(text("SELECT * FROM clientes_condiciones ORDER BY id")).fetchall()
    clientes_orig = [dict(r._mapping) for r in clientes_raw]

    return {
        "sku": sku,
        "costo_total_actual_clp": round(costo_total_clp, 2),
        "costo_total_actual_usd": round(costo_total_usd, 2),
        "merma_factor": round(merma_factor, 4),
        "costo_total_con_merma": round(costo_total_con_merma, 2),
        "costo_mp_clp": round(costo_mp_clp, 2),
        "costo_insumos_clp": round(costo_insumos_clp, 2),
        "peso_kilos": round(kilos_formato, 4),
        "litros_formato": round(litros_formato, 4),
        "densidad": round(densidad, 4),
        "formato": formato,
        "costo_por_kilo": costo_por_kilo,
        "costo_por_litro": costo_por_litro,
        "flete_clp": round(flete, 2),
        "pallet_clp": round(pallet, 2),
        "ley_rep_clp": round(ley_rep, 2),
        "disposicion_clp": round(disposicion, 2),
        "gtos_indirectos_clp": round(gtos_indirectos, 2),
        "costo_final_clp": round(costo_final_clp, 2),
        "tipo_cambio_usd": float(param_dict.get("tipo_cambio_usd", 950)),
        "detalle_insumos": insumos,
        "rentabilidad_clientes": rentabilidad_clientes,
        "clientes_orig": clientes_orig,
    }

def simular_escenario(sku: str, moneda_simulacion: str, db: Session,
                      insumos=None, nuevos_costos: dict = None):
    # 1. Obtener costo actual del BOM real (para calcular variación)
    query = text("SELECT * FROM explotar_costo_sku(:sku)")
    result = db.execute(query, {"sku": sku}).fetchall()

    if not result and not insumos:
        raise ValueError("El SKU no existe o no tiene insumos en su receta.")

    df_base = pd.DataFrame([dict(row._mapping) for row in result]) if result else pd.DataFrame()
    for col in ['cantidad_requerida_formato', 'costo_unitario_clp_actual', 'costo_teorico_total_clp']:
        if col in df_base.columns:
            df_base[col] = df_base[col].astype(float)
    costo_actual_total_clp = float(df_base['costo_teorico_total_clp'].sum()) if not df_base.empty else 0.0

    # 2. Calcular costo simulado
    if insumos is not None:
        # Nuevo modo: lista unificada (cantidad + costo por ítem)
        costo_proyectado_total_clp = sum(
            float(i.cantidad) * float(i.costo_unitario) for i in insumos
        )
    else:
        # Modo legacy: parchear costos sobre el BOM
        df_simulado = df_base.copy()
        for insumo_sku, costo_sim in (nuevos_costos or {}).items():
            mask = df_simulado['insumo_final'] == insumo_sku
            if moneda_simulacion == 'USD':
                df_simulado.loc[mask, 'costo_unitario_usd_actual'] = float(costo_sim)
                df_simulado.loc[mask, 'costo_teorico_total_usd'] = (
                    df_simulado.loc[mask, 'cantidad_requerida_formato'] *
                    df_simulado.loc[mask, 'costo_unitario_usd_actual']
                )
            else:
                df_simulado.loc[mask, 'costo_unitario_clp_actual'] = float(costo_sim)
                df_simulado.loc[mask, 'costo_teorico_total_clp'] = (
                    df_simulado.loc[mask, 'cantidad_requerida_formato'] *
                    df_simulado.loc[mask, 'costo_unitario_clp_actual']
                )
        costo_proyectado_total_clp = float(df_simulado['costo_teorico_total_clp'].sum())

    # 3. Obtener parámetros comerciales y peso del formato
    param_query = text("SELECT * FROM parametros_comerciales WHERE id = 1")
    param_dict = dict(db.execute(param_query).fetchone()._mapping)

    maestro_q = text("SELECT nombre, unidad_medida, densidad, familia FROM maestro_skus WHERE sku = :sku LIMIT 1")
    maestro_r = db.execute(maestro_q, {"sku": sku}).fetchone()
    nombre_pt_sim = str(maestro_r.nombre).strip()        if maestro_r else ""
    formato_sim   = str(maestro_r.unidad_medida).strip() if maestro_r else ""
    densidad_sim  = float(maestro_r.densidad) if maestro_r and maestro_r.densidad is not None else 0.0
    familia_sim   = str(maestro_r.familia or '').strip().upper() if maestro_r else ""

    factor_q = text("SELECT litros, kilo_neto FROM factores_conversion WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1")
    factor_r = db.execute(factor_q, {"sku": sku, "unidad": formato_sim}).fetchone()
    if factor_r and factor_r.litros:
        litros_sim = float(factor_r.litros)
        kilos_sim  = float(factor_r.kilo_neto) if factor_r.kilo_neto else round(densidad_sim * litros_sim, 4)
    else:
        litros_sim = extraer_litros_formato(nombre_pt_sim, formato_sim)
        kilos_sim  = round(densidad_sim * litros_sim, 4) if densidad_sim > 0 and litros_sim > 0 else 0.0
    peso_kg = kilos_sim if kilos_sim > 0 else 1.0

    # 4. Calcular agregados totales — flete y pallet base desde canal Terreno
    terreno_row_sim = db.execute(text("""
        SELECT flete_agua_kilo, flete_otros_kilo, pallet_agua_kilo, pallet_otros_kilo
        FROM clientes_condiciones WHERE cliente ILIKE 'Terreno' LIMIT 1
    """)).mappings().first()
    es_agua_sim = familia_sim in FAMILIAS_BASE_AGUA
    if terreno_row_sim:
        flete_kilo_sim  = float(terreno_row_sim['flete_agua_kilo']  if es_agua_sim else terreno_row_sim['flete_otros_kilo'])
        pallet_kilo_sim = float(terreno_row_sim['pallet_agua_kilo'] if es_agua_sim else terreno_row_sim['pallet_otros_kilo'])
    else:
        flete_kilo_sim  = float(param_dict['costo_flete_base_kilo'])
        pallet_kilo_sim = float(param_dict.get('costo_pallet_base_kilo', 0))
    flete = peso_kg * flete_kilo_sim
    pallet = peso_kg * pallet_kilo_sim
    ley_rep = _calcular_ley_rep(sku, formato_sim, peso_kg, param_dict, db)
    disposicion = peso_kg * float(param_dict['disposicion_por_kilo'])
    merma_factor_sim = float(param_dict.get('merma_global_factor', 1.0))
    costo_proyectado_con_merma = round(costo_proyectado_total_clp * merma_factor_sim, 2)
    gtos_indirectos = costo_proyectado_con_merma * float(param_dict['gastos_indirectos_porcentaje'])

    costo_final_clp = costo_proyectado_con_merma + flete + pallet + ley_rep + disposicion + gtos_indirectos

    variacion_abs_clp = costo_proyectado_total_clp - costo_actual_total_clp
    variacion_porc = (variacion_abs_clp / costo_actual_total_clp) * 100 if costo_actual_total_clp > 0 else 0

    # 5. Rentabilidades post-simulación
    rentabilidad_clientes = calcular_rentabilidad_clientes(costo_proyectado_con_merma, peso_kg, db, familia_sim, sku, formato_sim)

    return {
        "SKU": sku,
        "Costo_Actual_CLP": round(costo_actual_total_clp, 2),
        "Costo_Simulado_CLP": round(costo_proyectado_total_clp, 2),
        "Variacion_Costo_Moneda_CLP": round(variacion_abs_clp, 2),
        "Variacion_Costo_Porcentaje": round(variacion_porc, 2),
        "Peso_Kilos": round(peso_kg, 2),
        "Flete_CLP": round(flete, 2),
        "Pallet_CLP": round(pallet, 2),
        "Ley_Rep_CLP": round(ley_rep, 2),
        "Disposicion_CLP": round(disposicion, 2),
        "Gtos_Indirectos_CLP": round(gtos_indirectos, 2),
        "Costo_Final_CLP": round(costo_final_clp, 2),
        "rentabilidad_clientes": rentabilidad_clientes
    }
