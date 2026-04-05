from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Dict, Optional
from database import get_db
from models import (SimularCostosRequest, SimularNuevaRecetaRequest, CostoSimuladoResponse, ExplosionResponse,
                    MaestroSKU, RecetaBOM, CostoHistorico, PrecioMargen,
                    CostoManualUpsert, CostoManualResponse)
from services.simulador import obtener_explosion, simular_escenario, _calcular_ley_rep, detectar_bom_circular
from routers._utils import handle_error

router = APIRouter(prefix="/api/costos", tags=["Costos y Simulador"])

@router.get("/buscar")
def buscar_sku(q: str = Query(..., description="Texto a buscar en SKU o Nombre"), tipo: Optional[str] = None, db: Session = Depends(get_db)):
    """Busca productos o insumos por código o descripción con autocompletado."""
    try:
        query_str = """
            SELECT 
                m.sku, 
                m.nombre, 
                m.tipo,
                m.unidad_medida,
                COALESCE(v.costo_unitario_clp, 0) AS costo_unitario_clp,
                COALESCE(v.costo_unitario_usd, 0) AS costo_unitario_usd
            FROM maestro_skus m
            LEFT JOIN vista_ultimo_costo v ON m.sku = v.sku
            WHERE (m.sku ILIKE :q OR unaccent(m.nombre) ILIKE unaccent(:q))
        """
        params = {"q": f"%{q}%"}
        
        if tipo:
            if tipo == 'Insumo':
                query_str += " AND m.tipo IN ('Insumo', 'Sub-receta')"
            else:
                query_str += " AND m.tipo = :tipo"
                params["tipo"] = tipo
                
        query_str += " ORDER BY m.nombre LIMIT 30"
        
        resultados = db.execute(text(query_str), params).fetchall()
        return [dict(row._mapping) for row in resultados]
    except Exception as e:
        handle_error(e)

@router.get("/{sku}/explosion", response_model=ExplosionResponse)
def explosion_costos(sku: str, db: Session = Depends(get_db)):
    try:
        result = obtener_explosion(sku, db)
        # Inyectar override de precio de venta si existe
        pv_row = db.execute(
            text("SELECT * FROM precio_venta_config WHERE sku = :sku"), {"sku": sku}
        ).mappings().first()
        if pv_row:
            result["pv_activo"]       = True
            result["pv_margen_pct"]   = float(pv_row["margen_pct"])
            result["pv_ajuste_pct"]   = float(pv_row["ajuste_pct"])
            result["pv_precio_venta"] = float(pv_row["precio_venta_clp"])
            result["pv_precio_final"] = float(pv_row["precio_final_clp"])
        else:
            result["pv_activo"]       = False
            result["pv_margen_pct"]   = 0.0
            result["pv_ajuste_pct"]   = 0.0
            result["pv_precio_venta"] = 0.0
            result["pv_precio_final"] = 0.0
        return result
    except Exception as e:
        handle_error(e)

@router.post("/{sku}/simulacion", response_model=CostoSimuladoResponse)
def simulacion_what_if(sku: str, payload: SimularCostosRequest, db: Session = Depends(get_db)):
    try:
        r = simular_escenario(
            sku,
            payload.moneda_simulacion,
            db,
            insumos=payload.insumos,
            nuevos_costos=payload.nuevos_costos,
        )
        return CostoSimuladoResponse(
            SKU=r["SKU"],
            Costo_Actual_CLP=r["Costo_Actual_CLP"],
            Costo_Simulado_CLP=r["Costo_Simulado_CLP"],
            Variacion_Costo_Moneda_CLP=r["Variacion_Costo_Moneda_CLP"],
            Variacion_Costo_Porcentaje=r["Variacion_Costo_Porcentaje"],
            Peso_Kilos=r["Peso_Kilos"],
            Flete_CLP=r["Flete_CLP"],
            Ley_Rep_CLP=r["Ley_Rep_CLP"],
            Disposicion_CLP=r["Disposicion_CLP"],
            Gtos_Indirectos_CLP=r["Gtos_Indirectos_CLP"],
            Costo_Final_CLP=r["Costo_Final_CLP"],
            rentabilidad_clientes=r["rentabilidad_clientes"],
        )
    except Exception as e:
        handle_error(e)

@router.post("/simular_nuevo", response_model=Dict)
def simular_nueva_receta(payload: SimularNuevaRecetaRequest, db: Session = Depends(get_db)):
    try:
        from services.simulador import calcular_rentabilidad_clientes
        rentabilidad = calcular_rentabilidad_clientes(payload.costo_base_mp, payload.peso_kg, db)
        
        param_query = text("SELECT * FROM parametros_comerciales WHERE id = 1")
        param_dict = dict(db.execute(param_query).fetchone()._mapping)
        
        flete = payload.peso_kg * float(param_dict['costo_flete_base_kilo'])
        ley_rep = payload.peso_kg * float(param_dict['ley_rep_por_kilo'])
        disposicion = payload.peso_kg * float(param_dict['disposicion_por_kilo'])
        gtos_indirectos = payload.costo_base_mp * float(param_dict['gastos_indirectos_porcentaje']) 
        costo_final_clp = payload.costo_base_mp + ley_rep + disposicion + gtos_indirectos

        return {
            "Costo_Base_MP": payload.costo_base_mp,
            "Peso_Kilos": payload.peso_kg,
            "Flete_CLP": round(flete, 2),
            "Ley_Rep_CLP": round(ley_rep, 2),
            "Disposicion_CLP": round(disposicion, 2),
            "Gtos_Indirectos_CLP": round(gtos_indirectos, 2),
            "Costo_Final_CLP": round(costo_final_clp, 2),
            "rentabilidad_clientes": rentabilidad
        }
    except Exception as e:
        handle_error(e)

# Endpoints Básicos CRUD (para insertar datos de prueba)
@router.post("/maestro")
def crear_sku(item: MaestroSKU, db: Session = Depends(get_db)):
    query = text("INSERT INTO maestro_skus (sku, nombre, tipo, unidad_medida) VALUES (:sku, :nombre, :tipo, :unidad_medida)")
    db.execute(query, {"sku": item.sku, "nombre": item.nombre, "tipo": item.tipo, "unidad_medida": item.unidad_medida})
    db.commit()
    return {"status": "ok", "sku": item.sku}

@router.post("/receta")
def agregar_receta(item: RecetaBOM, db: Session = Depends(get_db)):
    # Detectar circularidad antes de insertar
    detectar_bom_circular(item.sku_padre, item.sku_hijo, db)
    try:
        query = text("""
        INSERT INTO recetas_bom (sku_padre, sku_hijo, cantidad_neta, porcentaje_merma)
        VALUES (:sku_padre, :sku_hijo, :cantidad_neta, :porcentaje_merma)
        """)
        db.execute(query, {
            "sku_padre": item.sku_padre,
            "sku_hijo": item.sku_hijo,
            "cantidad_neta": item.cantidad_neta,
            "porcentaje_merma": item.porcentaje_merma
        })
        db.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        handle_error(e, "agregar_receta_bom")

@router.post("/historico")
def agregar_costo_historico(item: CostoHistorico, db: Session = Depends(get_db)):
    query = text("INSERT INTO costos_historicos (sku, costo_unitario, proveedor) VALUES (:sku, :costo, :proveedor)")
    db.execute(query, {"sku": item.sku, "costo": item.costo_unitario, "proveedor": item.proveedor})
    db.commit()
    return {"status": "ok"}
    
@router.post("/precio")
def agregar_precio_venta(item: PrecioMargen, db: Session = Depends(get_db)):
    query = text("""
    INSERT INTO precios_margenes (sku, precio_venta, impuestos, canal_venta)
    VALUES (:sku, :precio, :impuestos, :canal)
    ON CONFLICT (sku) DO UPDATE SET precio_venta = EXCLUDED.precio_venta
    """)
    db.execute(query, {
        "sku": item.sku, "precio": item.precio_venta,
        "impuestos": item.impuestos, "canal": item.canal_venta
    })
    db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Costos Manuales — fallback para insumos sin historial de compras
# ---------------------------------------------------------------------------

@router.get("/materias-primas", response_model=List[Dict])
def consulta_materias_primas(
    q:      Optional[str] = None,
    tipo:   Optional[str] = None,   # 'Insumo' | 'Sub-receta' | None = todos
    fuente: Optional[str] = None,   # 'compra' | 'manual' | 'sin_precio' | None = todos
    db: Session = Depends(get_db)
):
    """Consulta pública de costos de materias primas e insumos (read-only)."""
    where = ["m.tipo IN ('Insumo', 'Sub-receta')"]
    params: dict = {}

    if q:
        where.append("(LOWER(m.sku) LIKE :q OR LOWER(m.nombre) LIKE :q)")
        params["q"] = f"%{q.lower()}%"

    if tipo in ("Insumo", "Sub-receta"):
        where.append("m.tipo = :tipo")
        params["tipo"] = tipo

    fuente_filter = ""
    if fuente == "sin_precio":
        fuente_filter = "AND (v.costo_unitario_clp IS NULL OR v.costo_unitario_clp = 0)"
    elif fuente in ("compra", "manual"):
        fuente_filter = f"AND v.fuente_costo = :fuente"
        params["fuente"] = fuente

    where_sql = " AND ".join(where)
    query = text(f"""
        SELECT
            m.sku,
            m.nombre,
            m.tipo,
            m.unidad_medida,
            COALESCE(v.costo_unitario_clp, 0)  AS costo_unitario_clp,
            COALESCE(v.costo_unitario_usd, 0)  AS costo_unitario_usd,
            COALESCE(v.fuente_costo, 'sin_precio') AS fuente_costo,
            v.fecha_compra                         AS fecha_actualizacion,
            COUNT(DISTINCT rb.sku_padre)            AS aparece_en_n_recetas
        FROM maestro_skus m
        LEFT JOIN vista_ultimo_costo v  ON v.sku = m.sku
        LEFT JOIN recetas_bom rb        ON rb.sku_hijo = m.sku
        WHERE {where_sql} {fuente_filter}
        GROUP BY m.sku, m.nombre, m.tipo, m.unidad_medida,
                 v.costo_unitario_clp, v.costo_unitario_usd, v.fuente_costo, v.fecha_compra
        ORDER BY m.nombre
    """)
    rows = db.execute(query, params).fetchall()
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------

@router.get("/alertas-variacion", response_model=List[Dict])
def alertas_variacion(
    umbral: float = 5.0,   # % mínimo de cambio para considerarse alerta
    db: Session = Depends(get_db)
):
    """
    Compara el último precio de compra de cada insumo con el penúltimo.
    Devuelve los insumos cuyo precio cambió más del umbral indicado,
    junto con cuántos productos terminados los usan.
    """
    rows = db.execute(text("""
        WITH ranked AS (
            SELECT
                ch.sku,
                ch.costo_unitario,
                ch.fecha_compra,
                ROW_NUMBER() OVER (PARTITION BY ch.sku ORDER BY ch.fecha_compra DESC, ch.costo_unitario DESC) AS rn
            FROM costos_historicos ch
        ),
        ultimo    AS (SELECT sku, costo_unitario AS costo_actual,  fecha_compra AS fecha_actual   FROM ranked WHERE rn = 1),
        penultimo AS (SELECT sku, costo_unitario AS costo_anterior, fecha_compra AS fecha_anterior FROM ranked WHERE rn = 2)
        SELECT
            u.sku,
            m.nombre,
            m.unidad_medida,
            u.costo_actual,
            p.costo_anterior,
            u.fecha_actual,
            p.fecha_anterior,
            ROUND(((u.costo_actual - p.costo_anterior) / NULLIF(p.costo_anterior, 0)) * 100, 2) AS variacion_pct,
            COUNT(DISTINCT rb.sku_padre) AS afecta_n_productos
        FROM ultimo u
        JOIN penultimo p ON p.sku = u.sku
        JOIN maestro_skus m ON m.sku = u.sku
        LEFT JOIN recetas_bom rb ON rb.sku_hijo = u.sku
        WHERE ABS(((u.costo_actual - p.costo_anterior) / NULLIF(p.costo_anterior, 0)) * 100) >= :umbral
        GROUP BY u.sku, m.nombre, m.unidad_medida,
                 u.costo_actual, p.costo_anterior, u.fecha_actual, p.fecha_anterior
        ORDER BY ABS(((u.costo_actual - p.costo_anterior) / NULLIF(p.costo_anterior, 0)) * 100) DESC
    """), {"umbral": umbral}).fetchall()
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------

@router.get("/sin_precio", response_model=List[Dict])
def insumos_sin_precio(db: Session = Depends(get_db)):
    """Lista todos los insumos que participan en recetas pero no tienen precio
    en costos_historicos ni en costos_manuales."""
    query = text("""
        SELECT DISTINCT
            m.sku,
            m.nombre,
            m.unidad_medida,
            COUNT(DISTINCT rb.sku_padre) AS aparece_en_n_recetas
        FROM maestro_skus m
        JOIN recetas_bom rb ON rb.sku_hijo = m.sku
        LEFT JOIN vista_ultimo_costo v ON v.sku = m.sku
        WHERE m.tipo = 'Insumo'
          AND (v.costo_unitario_clp IS NULL OR v.costo_unitario_clp = 0)
        GROUP BY m.sku, m.nombre, m.unidad_medida
        ORDER BY aparece_en_n_recetas DESC, m.nombre
    """)
    rows = db.execute(query).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/manuales", response_model=List[CostoManualResponse])
def listar_costos_manuales(db: Session = Depends(get_db)):
    """Lista todos los costos ingresados manualmente."""
    query = text("""
        SELECT cm.sku, m.nombre, m.unidad_medida,
               COALESCE(m.densidad, 1.0) AS densidad,
               cm.costo_unitario_clp, cm.fecha_actualizacion,
               cm.notas, cm.usuario,
               cm.precio_cotizacion, cm.moneda_cotizacion, cm.unidad_cotizacion,
               (SELECT tipo_cambio_usd FROM parametros_comerciales WHERE id = 1) AS tipo_cambio_usd
        FROM costos_manuales cm
        JOIN maestro_skus m ON m.sku = cm.sku
        ORDER BY m.nombre
    """)
    rows = db.execute(query).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/manual", response_model=Dict)
def upsert_costo_manual(item: CostoManualUpsert, db: Session = Depends(get_db)):
    """Crea o actualiza el costo manual de un insumo (INSERT OR UPDATE)."""
    try:
        # Verificar que el SKU existe
        existe = db.execute(
            text("SELECT 1 FROM maestro_skus WHERE sku = :sku"), {"sku": item.sku}
        ).fetchone()
        if not existe:
            raise HTTPException(status_code=404, detail=f"SKU '{item.sku}' no encontrado en maestro.")

        db.execute(
            text("""
                INSERT INTO costos_manuales (sku, costo_unitario_clp, fecha_actualizacion, notas, usuario,
                                            precio_cotizacion, moneda_cotizacion, unidad_cotizacion)
                VALUES (:sku, :costo, CURRENT_DATE, :notas, :usuario, :precio_cot, :moneda_cot, :unidad_cot)
                ON CONFLICT (sku) DO UPDATE SET
                    costo_unitario_clp  = EXCLUDED.costo_unitario_clp,
                    fecha_actualizacion = CURRENT_DATE,
                    notas               = EXCLUDED.notas,
                    usuario             = EXCLUDED.usuario,
                    precio_cotizacion   = EXCLUDED.precio_cotizacion,
                    moneda_cotizacion   = EXCLUDED.moneda_cotizacion,
                    unidad_cotizacion   = EXCLUDED.unidad_cotizacion
            """),
            {"sku": item.sku, "costo": item.costo_unitario_clp,
             "notas": item.notas, "usuario": item.usuario,
             "precio_cot": item.precio_cotizacion, "moneda_cot": item.moneda_cotizacion,
             "unidad_cot": item.unidad_cotizacion}
        )
        db.commit()
        return {"status": "ok", "sku": item.sku, "costo_unitario_clp": item.costo_unitario_clp}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        handle_error(e, "upsert_costo_manual")


# ---------------------------------------------------------------------------
# Consulta Masiva — por familia y subfamilia
# ---------------------------------------------------------------------------

@router.get("/formatos", response_model=List[str])
def listar_formatos(db: Session = Depends(get_db)):
    """Lista todas las unidades de medida únicas del maestro de SKUs."""
    rows = db.execute(text("""
        SELECT DISTINCT unidad_medida
        FROM maestro_skus
        WHERE unidad_medida IS NOT NULL AND unidad_medida != ''
        ORDER BY unidad_medida
    """)).fetchall()
    return [r[0] for r in rows]


@router.get("/familias", response_model=List[str])
def listar_familias(db: Session = Depends(get_db)):
    """Lista todas las familias únicas de Productos Terminados."""
    rows = db.execute(text("""
        SELECT DISTINCT familia
        FROM maestro_skus
        WHERE tipo = 'Producto Terminado' AND familia IS NOT NULL
        ORDER BY familia
    """)).fetchall()
    return [r[0] for r in rows]


@router.get("/subfamilias", response_model=List[str])
def listar_subfamilias(familia: Optional[str] = None, db: Session = Depends(get_db)):
    """Lista subfamilias únicas; si se pasa familia filtra por ella."""
    if familia:
        rows = db.execute(text("""
            SELECT DISTINCT subfamilia
            FROM maestro_skus
            WHERE tipo = 'Producto Terminado'
              AND familia = :familia
              AND subfamilia IS NOT NULL
            ORDER BY subfamilia
        """), {"familia": familia}).fetchall()
    else:
        rows = db.execute(text("""
            SELECT DISTINCT subfamilia
            FROM maestro_skus
            WHERE tipo = 'Producto Terminado' AND subfamilia IS NOT NULL
            ORDER BY subfamilia
        """)).fetchall()
    return [r[0] for r in rows]


@router.get("/masivo", response_model=List[Dict])
def costos_masivo(
    familia: Optional[str] = None,
    subfamilia: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Devuelve todos los Productos Terminados con su costo total (MP),
    filtrados por familia y/o subfamilia.
    """
    where_clauses = ["m.tipo = 'Producto Terminado'"]
    params: Dict = {}
    if familia:
        where_clauses.append("m.familia = :familia")
        params["familia"] = familia
    if subfamilia:
        where_clauses.append("m.subfamilia = :subfamilia")
        params["subfamilia"] = subfamilia

    where_sql = " AND ".join(where_clauses)

    skus_rows = db.execute(text(f"""
        SELECT m.sku, m.nombre, m.familia, m.subfamilia, m.unidad_medida
        FROM maestro_skus m
        WHERE {where_sql}
        ORDER BY m.familia, m.subfamilia, m.nombre
    """), params).fetchall()

    # Parámetros comerciales (una sola consulta fuera del loop)
    param_row = db.execute(text("SELECT * FROM parametros_comerciales ORDER BY id DESC LIMIT 1")).mappings().first()
    if param_row:
        param_dict   = dict(param_row)
        disp_kg      = float(param_row['disposicion_por_kilo'] or 0)
        gtos_pct     = float(param_row['gastos_indirectos_porcentaje'] or 0)
        merma_factor = float(param_row['merma_global_factor'] or 1.0)
    else:
        param_dict   = {}
        disp_kg = gtos_pct = 0.0
        merma_factor = 1.0

    # Condiciones Terreno (canal directo — base del masivo)
    terreno_row = db.execute(text("""
        SELECT flete_agua_kilo, flete_otros_kilo, pallet_agua_kilo, pallet_otros_kilo
        FROM clientes_condiciones WHERE cliente ILIKE 'Terreno' LIMIT 1
    """)).mappings().first()
    if terreno_row:
        terreno_flete_agua   = float(terreno_row['flete_agua_kilo']   or 0)
        terreno_flete_otros  = float(terreno_row['flete_otros_kilo']  or 0)
        terreno_pallet_agua  = float(terreno_row['pallet_agua_kilo']  or 0)
        terreno_pallet_otros = float(terreno_row['pallet_otros_kilo'] or 0)
    else:
        terreno_flete_agua = terreno_flete_otros = terreno_pallet_agua = terreno_pallet_otros = 0.0

    FAMILIAS_BASE_AGUA = {'PINTURAS AL AGUA', 'LATEX'}

    FAMILIAS_PACKAGING = {
        'ENVASES', 'TAPAS', 'CAJAS', 'ETIQUETAS',
        'OTROS INSUMOS ENVASADO', 'PALLET', 'COMPLEMENTOS PINTURAS'
    }

    # Override precio de venta
    pv_rows = db.execute(text("SELECT sku, precio_final_clp FROM precio_venta_config")).mappings().all()
    pv_override = {r["sku"]: float(r["precio_final_clp"]) for r in pv_rows}

    resultados = []
    for row in skus_rows:
        sku, nombre, fam, subfam, unidad = row[0], row[1], row[2], row[3], row[4]
        try:
            bom = db.execute(text("SELECT * FROM explotar_costo_sku(:sku)"), {"sku": sku}).fetchall()
            tiene_bom = len(bom) > 0
            sin_precio = sum(1 for r in bom if r[8] == 'sin_precio') if bom else 0

            if bom:
                bom_skus = [r[0] for r in bom]
                placeholders = ", ".join(f":s{i}" for i in range(len(bom_skus)))
                fam_params = {f"s{i}": bom_skus[i] for i in range(len(bom_skus))}
                fam_rows = db.execute(
                    text(f"SELECT sku, familia FROM maestro_skus WHERE sku IN ({placeholders})"),
                    fam_params
                ).mappings().all()
                familia_map = {r['sku']: (r['familia'] or '').upper() for r in fam_rows}

                costo_mp = 0.0
                costo_insumos = 0.0
                for r in bom:
                    costo_item = float(r[6])
                    if familia_map.get(r[0], '') in FAMILIAS_PACKAGING:
                        costo_insumos += costo_item
                    else:
                        costo_mp += costo_item

                fc_row = db.execute(text("""
                    SELECT kilo_neto FROM factores_conversion
                    WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1
                """), {"sku": sku, "unidad": unidad or ''}).mappings().first()
                peso_kg = float(fc_row['kilo_neto']) if fc_row and fc_row['kilo_neto'] else 0.0

                costo_bom       = costo_mp + costo_insumos
                costo_con_merma = round(costo_bom * merma_factor, 2)
                ley_rep  = _calcular_ley_rep(sku, unidad or '', peso_kg, param_dict, db)
                disp     = round(disp_kg * peso_kg, 2)
                gtos     = round(costo_con_merma * gtos_pct, 2)
                gastos_adic  = ley_rep + disp + gtos
                costo_final  = round(costo_con_merma + gastos_adic, 2)

                # Precio Terreno: costo producción + flete y pallet según canal
                es_agua = (fam or '').upper() in FAMILIAS_BASE_AGUA
                flete_t  = round((terreno_flete_agua  if es_agua else terreno_flete_otros)  * peso_kg, 2)
                pallet_t = round((terreno_pallet_agua if es_agua else terreno_pallet_otros) * peso_kg, 2)
                precio_terreno = round(costo_final + flete_t + pallet_t, 2)
            else:
                costo_mp = costo_insumos = gastos_adic = costo_final = 0.0
                flete_t = pallet_t = precio_terreno = 0.0

        except Exception:
            costo_mp = costo_insumos = gastos_adic = costo_final = 0.0
            flete_t = pallet_t = precio_terreno = 0.0
            tiene_bom = False
            sin_precio = 0

        # Aplicar override de precio de venta si existe
        pv_activo = sku in pv_override
        if pv_activo:
            precio_terreno = pv_override[sku]

        resultados.append({
            "sku": sku,
            "nombre": nombre,
            "familia": fam,
            "subfamilia": subfam,
            "unidad_medida": unidad,
            "costo_mp_clp": round(costo_mp, 2),
            "costo_insumos_clp": round(costo_insumos, 2),
            "gastos_adicionales_clp": round(gastos_adic, 2),
            "costo_final_clp": round(costo_final, 2),
            "flete_terreno_clp": round(flete_t, 2),
            "pallet_terreno_clp": round(pallet_t, 2),
            "precio_terreno_clp": round(precio_terreno, 2),
            "pv_activo": pv_activo,
            "tiene_bom": tiene_bom,
            "insumos_sin_precio": sin_precio,
        })

    return resultados


@router.get("/masivo-cadenas", response_model=List[Dict])
def costos_masivo_cadenas(
    cadena_id: int = Query(..., description="ID de la cadena/cliente"),
    familia: Optional[str] = None,
    subfamilia: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Devuelve todos los PT (filtrados por familia/subfamilia) con el costeo
    aplicado según las condiciones comerciales de la cadena indicada.
    """
    from fastapi import HTTPException as _HTTPException

    cliente_row = db.execute(
        text("SELECT * FROM clientes_condiciones WHERE id = :id"), {"id": cadena_id}
    ).mappings().first()
    if not cliente_row:
        raise _HTTPException(status_code=404, detail="Cadena no encontrada")
    c = dict(cliente_row)

    param_row = db.execute(
        text("SELECT * FROM parametros_comerciales WHERE id = 1")
    ).mappings().first()
    p = dict(param_row) if param_row else {}

    merma    = float(p.get('merma_global_factor', 1.0))
    disp_kg  = float(p.get('disposicion_por_kilo', 0))
    gtos_pct = float(p.get('gastos_indirectos_porcentaje', 0))

    where_clauses = ["m.tipo = 'Producto Terminado'"]
    params_q: Dict = {}
    if familia:
        where_clauses.append("m.familia = :familia")
        params_q["familia"] = familia
    if subfamilia:
        where_clauses.append("m.subfamilia = :subfamilia")
        params_q["subfamilia"] = subfamilia

    skus_rows = db.execute(text(f"""
        SELECT m.sku, m.nombre, m.familia, m.subfamilia, m.unidad_medida
        FROM maestro_skus m
        WHERE {' AND '.join(where_clauses)}
        ORDER BY m.familia, m.subfamilia, m.nombre
    """), params_q).fetchall()

    FAMILIAS_PACKAGING = {
        'ENVASES', 'TAPAS', 'CAJAS', 'ETIQUETAS',
        'OTROS INSUMOS ENVASADO', 'PALLET', 'COMPLEMENTOS PINTURAS'
    }
    FAMILIAS_BASE_AGUA = {'PINTURAS AL AGUA', 'LATEX'}

    # Cargar overrides de precio de venta para esta consulta
    pv_rows_c = db.execute(text("SELECT sku, precio_final_clp FROM precio_venta_config")).mappings().all()
    pv_override_c = {r["sku"]: float(r["precio_final_clp"]) for r in pv_rows_c}

    resultados = []
    for row in skus_rows:
        sku, nombre, fam, subfam, unidad = row[0], row[1], row[2], row[3], row[4]
        try:
            bom = db.execute(text("SELECT * FROM explotar_costo_sku(:sku)"), {"sku": sku}).fetchall()
            tiene_bom  = len(bom) > 0
            sin_precio = sum(1 for r in bom if r[8] == 'sin_precio') if bom else 0

            if bom:
                bom_skus = [r[0] for r in bom]
                placeholders = ", ".join(f":s{i}" for i in range(len(bom_skus)))
                fam_params = {f"s{i}": bom_skus[i] for i in range(len(bom_skus))}
                fam_rows = db.execute(
                    text(f"SELECT sku, familia FROM maestro_skus WHERE sku IN ({placeholders})"),
                    fam_params
                ).mappings().all()
                familia_map = {r['sku']: (r['familia'] or '').upper() for r in fam_rows}

                costo_mp      = sum(float(r[6]) for r in bom if familia_map.get(r[0], '') not in FAMILIAS_PACKAGING)
                costo_insumos = sum(float(r[6]) for r in bom if familia_map.get(r[0], '') in FAMILIAS_PACKAGING)
                costo_bom     = costo_mp + costo_insumos

                fc_row = db.execute(text("""
                    SELECT kilo_neto FROM factores_conversion
                    WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1
                """), {"sku": sku, "unidad": unidad or ''}).mappings().first()
                peso_kg = float(fc_row['kilo_neto']) if fc_row and fc_row['kilo_neto'] else 0.0

                costo_base      = round(costo_bom * merma, 4)
                ley_rep_clp     = _calcular_ley_rep(sku, unidad or '', peso_kg, p, db)
                disposicion_clp = round(peso_kg * disp_kg, 2)
                gtos_ind_clp    = round(costo_base * gtos_pct, 2)

                es_base_agua = (fam or '').upper() in FAMILIAS_BASE_AGUA
                if es_base_agua:
                    flete_kilo  = float(c.get('flete_agua_kilo') or 0)
                    pallet_kilo = float(c.get('pallet_agua_kilo') or 0)
                else:
                    flete_kilo  = float(c.get('flete_otros_kilo') or 0)
                    pallet_kilo = float(c.get('pallet_otros_kilo') or 0)

                flete_clp  = round(peso_kg * flete_kilo, 2)
                pallet_clp = round(peso_kg * pallet_kilo, 2)

                costo_final_clp = round(costo_base + ley_rep_clp + disposicion_clp + gtos_ind_clp, 2)
                costo_parcial   = round(costo_final_clp + flete_clp + pallet_clp, 2)

                factor   = float(c['factor'])
                desc_max = float(c['descuento_max'])
                p_lista  = round(costo_parcial * factor, 2)
                p_final  = round(p_lista * (1.0 - desc_max), 2)

                com_pct  = float(c['comision_promedio'])
                plan_pct = (float(c['rapell']) + float(c['fee']) + float(c['marketing'])
                            + float(c['x_docking']) + float(c['rebate']) + float(c['rebate_centralizacion']))
                comision_monto = round(p_final * com_pct, 2)
                plan_monto     = round(p_final * plan_pct, 2)

                # Override precio de venta: reemplaza costo_parcial como base del cascade
                pv_activo_c = sku in pv_override_c
                if pv_activo_c:
                    costo_parcial = pv_override_c[sku]
                    p_lista  = round(costo_parcial * factor, 2)
                    p_final  = round(p_lista * (1.0 - desc_max), 2)
                    comision_monto = round(p_final * com_pct, 2)
                    plan_monto     = round(p_final * plan_pct, 2)

                costo_total = round(costo_parcial + comision_monto + plan_monto, 2)
                utilidad    = round(p_final - costo_total, 2)
                mg_final    = round((utilidad / p_final * 100) if p_final > 0 else 0, 2)
                mg_lista    = round(((p_lista - costo_total) / p_lista * 100) if p_lista > 0 else 0, 2)
            else:
                pv_activo_c = False
                costo_bom = peso_kg = flete_clp = pallet_clp = 0.0
                ley_rep_clp = disposicion_clp = gtos_ind_clp = costo_parcial = 0.0
                p_lista = p_final = comision_monto = plan_monto = costo_total = 0.0
                utilidad = mg_final = mg_lista = 0.0

        except Exception:
            costo_bom = peso_kg = flete_clp = pallet_clp = 0.0
            ley_rep_clp = disposicion_clp = gtos_ind_clp = costo_parcial = 0.0
            p_lista = p_final = comision_monto = plan_monto = costo_total = 0.0
            utilidad = mg_final = mg_lista = 0.0
            tiene_bom = False
            sin_precio = 0
            pv_activo_c = False

        resultados.append({
            "sku":                  sku,
            "nombre":               nombre,
            "familia":              fam,
            "subfamilia":           subfam,
            "peso_kg":              round(peso_kg if bom else 0.0, 4),
            "costo_bom_clp":        round(costo_bom, 2),
            "flete_clp":            flete_clp,
            "pallet_clp":           pallet_clp,
            "ley_rep_clp":          ley_rep_clp,
            "costo_final_clp":      round(costo_final_clp if tiene_bom else 0.0, 2),
            "costo_parcial":        costo_parcial,
            "precio_lista":         p_lista,
            "precio_final":         p_final,
            "comision_monto":       comision_monto,
            "plan_monto":           plan_monto,
            "costo_total":          costo_total,
            "utilidad":             utilidad,
            "mg_lista_pct":         mg_lista,
            "mg_final_pct":         mg_final,
            "tiene_bom":            tiene_bom,
            "insumos_sin_precio":   sin_precio,
            "pv_activo":            pv_activo_c,
        })

    return resultados


@router.get("/buscar-insumos", response_model=List[Dict])
def buscar_insumos_con_costo(q: str = "", db: Session = Depends(get_db)):
    """Busca insumos (no PT) con su costo vigente y estado de override manual."""
    query = text("""
        SELECT
            m.sku,
            m.nombre,
            m.unidad_medida,
            m.tipo,
            COALESCE(m.densidad, 1.0)           AS densidad,
            COALESCE(v.costo_unitario_clp, 0)   AS costo_actual_clp,
            COALESCE(v.fuente_costo, 'sin_precio') AS fuente_costo,
            cm.costo_unitario_clp               AS costo_manual_clp,
            cm.fecha_actualizacion              AS fecha_manual,
            ch_ult.costo_unitario               AS costo_compra_clp,
            (SELECT tipo_cambio_usd FROM parametros_comerciales WHERE id = 1) AS tipo_cambio_usd
        FROM maestro_skus m
        LEFT JOIN vista_ultimo_costo v    ON v.sku = m.sku
        LEFT JOIN costos_manuales cm      ON cm.sku = m.sku
        LEFT JOIN (
            SELECT DISTINCT ON (sku) sku, costo_unitario
            FROM costos_historicos
            ORDER BY sku, fecha_compra DESC, costo_unitario DESC
        ) ch_ult ON ch_ult.sku = m.sku
        WHERE m.tipo <> 'Producto Terminado'
          AND (
              m.sku    ILIKE :q
           OR m.nombre ILIKE :q
          )
        ORDER BY m.nombre
        LIMIT 60
    """)
    rows = db.execute(query, {"q": f"%{q}%"}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/precio-desde-base", response_model=Dict)
def precio_desde_base(payload: Dict, db: Session = Depends(get_db)):
    """
    Calcula el precio de venta a todas las cadenas a partir de un costo base
    ingresado manualmente, usando los parámetros comerciales de la BD.
    El usuario puede sobreescribir individualmente cada parámetro global.
    """
    sku            = payload.get("sku", "")
    costo_base_clp = float(payload.get("costo_base_clp", 0))

    # ─── Datos del producto ───
    prod_row = db.execute(text("""
        SELECT m.nombre, m.familia, m.subfamilia, m.unidad_medida, m.tipo
        FROM maestro_skus m WHERE m.sku = :sku
    """), {"sku": sku}).mappings().first()
    if not prod_row:
        raise HTTPException(status_code=404, detail=f"SKU '{sku}' no encontrado.")

    nombre   = prod_row["nombre"]
    familia  = (prod_row["familia"] or "").upper()
    unidad   = prod_row["unidad_medida"] or ""

    # ─── Peso (factores_conversion) ───
    fc_row = db.execute(text("""
        SELECT kilo_neto FROM factores_conversion
        WHERE sku = :sku AND unidad ILIKE :unidad LIMIT 1
    """), {"sku": sku, "unidad": unidad}).mappings().first()
    peso_kg = float(fc_row["kilo_neto"]) if fc_row and fc_row["kilo_neto"] else 0.0

    # ─── Costo BOM de referencia ───
    try:
        bom_ref = db.execute(text("SELECT * FROM explotar_costo_sku(:sku)"), {"sku": sku}).fetchall()
        costo_bom_ref = sum(float(r[6]) for r in bom_ref) if bom_ref else 0.0
    except Exception:
        costo_bom_ref = 0.0

    # ─── Parámetros de la BD (base) ───
    param_row = db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).mappings().first()
    p_db = dict(param_row) if param_row else {}

    # Permitir override de parámetros globales por el usuario (si viene en payload)
    def get_param(key: str, db_key: str, default: float = 0.0) -> float:
        if key in payload and payload[key] is not None:
            return float(payload[key])
        return float(p_db.get(db_key) or default)

    merma_factor   = get_param("merma_factor",       "merma_global_factor",         1.0)
    flete_base_kg  = get_param("flete_base_kilo",   "costo_flete_base_kilo",       0.0)
    pallet_base_kg = get_param("pallet_base_kilo",  "costo_pallet_base_kilo",      0.0)
    disp_kg        = get_param("disposicion_kilo",  "disposicion_por_kilo",        0.0)
    gtos_pct       = get_param("gastos_indirectos", "gastos_indirectos_porcentaje",0.0)
    valor_uf      = float(p_db.get("valor_uf") or 37000)

    # ─── Ley REP (jerarquía: SKU → Formato → Global) ───
    # Solo usar override si el usuario envió un valor positivo explícito (>0)
    # Si viene 0, null o vacío → resolver automáticamente desde la BD
    ley_rep_override = payload.get("ley_rep_clp")
    _override_val = float(ley_rep_override) if ley_rep_override not in (None, '', 0, 0.0) else 0
    if _override_val > 0:
        ley_rep_clp = _override_val
    else:
        sku_rep_row = db.execute(text(
            "SELECT ley_rep_clp FROM ley_rep_skus WHERE sku = :sku LIMIT 1"
        ), {"sku": sku}).fetchone()
        if sku_rep_row and sku_rep_row[0]:
            ley_rep_clp = float(sku_rep_row[0])
        else:
            fmt_rep_row = db.execute(text("""
                SELECT uf_por_formato FROM ley_rep_formatos
                WHERE :unidad ILIKE '%' || formato || '%' OR formato ILIKE '%' || :unidad || '%'
                LIMIT 1
            """), {"unidad": unidad}).fetchone()
            if fmt_rep_row and fmt_rep_row[0]:
                ley_rep_clp = round(float(fmt_rep_row[0]) * valor_uf, 2)
            else:
                ley_rep_kg = float(p_db.get("ley_rep_por_kilo") or 0)
                ley_rep_clp = round(peso_kg * ley_rep_kg, 2)

    # ─── Desglose base ───
    costo_con_merma    = round(costo_base_clp * merma_factor, 2)
    flete_base_clp     = round(peso_kg * flete_base_kg, 2)
    pallet_base_clp    = round(peso_kg * pallet_base_kg, 2)
    disposicion_clp    = round(peso_kg * disp_kg, 2)
    gtos_ind_clp       = round(costo_con_merma * gtos_pct, 2)
    costo_parcial_base = round(costo_con_merma + flete_base_clp + pallet_base_clp + ley_rep_clp + disposicion_clp + gtos_ind_clp, 2)

    # ─── Por cadena ───
    FAMILIAS_BASE_AGUA = {"PINTURAS AL AGUA", "LATEX"}
    es_base_agua = familia in FAMILIAS_BASE_AGUA

    cadenas_rows = db.execute(text("SELECT * FROM clientes_condiciones ORDER BY cliente")).mappings().all()

    cadenas = []
    for c in cadenas_rows:
        if es_base_agua:
            flete_cad_kg  = float(c.get("flete_agua_kilo")  or 0)
            pallet_cad_kg = float(c.get("pallet_agua_kilo") or 0)
        else:
            flete_cad_kg  = float(c.get("flete_otros_kilo") or 0)
            pallet_cad_kg = float(c.get("pallet_otros_kilo") or 0)

        flete_cadena  = round(peso_kg * flete_cad_kg,  2)
        pallet_cadena = round(peso_kg * pallet_cad_kg, 2)
        costo_parcial = round(costo_parcial_base + flete_cadena + pallet_cadena, 2)

        factor   = float(c["factor"]       or 1.0)
        desc_max = float(c["descuento_max"] or 0.0)
        com_pct  = float(c["comision_promedio"] or 0.0)
        plan_pct = (float(c["rapell"] or 0) + float(c["fee"] or 0) + float(c["marketing"] or 0)
                  + float(c["x_docking"] or 0) + float(c["rebate"] or 0) + float(c["rebate_centralizacion"] or 0))

        p_lista  = round(costo_parcial * factor, 2)
        p_final  = round(p_lista * (1.0 - desc_max), 2)
        com_monto  = round(p_final * com_pct, 2)
        plan_monto = round(p_final * plan_pct, 2)
        costo_total  = round(costo_parcial + com_monto + plan_monto, 2)
        utilidad     = round(p_final - costo_total, 2)
        mg_final_pct = round((utilidad / p_final * 100) if p_final > 0 else 0, 2)
        mg_lista_pct = round(((p_lista - costo_total) / p_lista * 100) if p_lista > 0 else 0, 2)

        cadenas.append({
            "cliente_id":          c["id"],
            "cliente":             c["cliente"],
            "flete_cadena":        flete_cadena,
            "pallet_cadena":       pallet_cadena,
            "costo_parcial":       costo_parcial,
            "factor":              factor,
            "descuento_max":       desc_max,
            "precio_lista":        p_lista,
            "precio_final":        p_final,
            "comision_pct":        round(com_pct * 100, 2),
            "comision_monto":      com_monto,
            "plan_comercial_pct":  round(plan_pct * 100, 2),
            "plan_comercial_monto":plan_monto,
            "costo_total":         costo_total,
            "utilidad":            utilidad,
            "mg_lista_pct":        mg_lista_pct,
            "mg_final_pct":        mg_final_pct,
        })

    return {
        "sku":                sku,
        "nombre":             nombre,
        "familia":            familia,
        "peso_kg":            peso_kg,
        "unidad":             unidad,
        "costo_bom_ref":      round(costo_bom_ref, 2),
        "params_usados": {
            "merma_factor":        merma_factor,
            "flete_base_kilo":     flete_base_kg,
            "ley_rep_clp":         ley_rep_clp,
            "disposicion_kilo":    disp_kg,
            "gastos_indirectos":   gtos_pct,
        },
        "desglose_base": {
            "costo_base":          costo_base_clp,
            "merma_factor":        merma_factor,
            "merma_monto":         round(costo_base_clp * (merma_factor - 1), 2),
            "costo_con_merma":     costo_con_merma,
            "flete_base":          flete_base_clp,
            "ley_rep":             ley_rep_clp,
            "disposicion":         disposicion_clp,
            "gtos_indirectos":     gtos_ind_clp,
            "costo_parcial_base":  costo_parcial_base,
        },
        "cadenas": cadenas,
    }


@router.get("/{sku}/ley-rep")
def get_ley_rep_sku(sku: str, db: Session = Depends(get_db)):
    """Devuelve la Ley REP resuelta para un SKU (jerarquía: ley_rep_skus → ley_rep_formatos → global)."""
    from services.simulador import _calcular_ley_rep
    param_row = db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).mappings().first()
    p = dict(param_row) if param_row else {}
    fc_row = db.execute(text("""
        SELECT kilo_neto, unidad FROM factores_conversion WHERE sku = :sku LIMIT 1
    """), {"sku": sku}).mappings().first()
    peso_kg = float(fc_row["kilo_neto"]) if fc_row and fc_row["kilo_neto"] else 0.0
    formato = fc_row["unidad"] if fc_row else ""
    ley_rep = _calcular_ley_rep(sku, formato, peso_kg, p, db)
    return {"sku": sku, "ley_rep_clp": round(ley_rep, 2)}


@router.delete("/manual/{sku}", response_model=Dict)
def eliminar_costo_manual(sku: str, db: Session = Depends(get_db)):
    """Elimina el costo manual de un SKU (el sistema vuelve a usar el último precio de compra)."""
    result = db.execute(
        text("DELETE FROM costos_manuales WHERE sku = :sku"), {"sku": sku}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No existe costo manual para SKU '{sku}'.")
    return {"status": "ok", "sku": sku}


# ── Precio de Venta Override ───────────────────────────────────────────────

@router.post("/masivo/precio-venta", response_model=Dict)
def masivo_set_precio_venta(payload: Dict, db: Session = Depends(get_db)):
    """Aplica override de precio de venta a múltiples SKUs en una sola operación."""
    items      = payload.get("items", [])   # [{sku, costo_final_clp}, ...]
    margen_pct = float(payload.get("margen_pct", 0))
    ajuste_pct = float(payload.get("ajuste_pct", 0))

    count = 0
    for item in items:
        sku             = item["sku"]
        costo_final_clp = float(item.get("costo_final_clp", 0))
        if costo_final_clp <= 0:
            continue
        precio_venta_clp = round(costo_final_clp * (1 + margen_pct / 100), 2)
        precio_final_clp = round(precio_venta_clp * (1 + ajuste_pct / 100), 2)
        db.execute(text("""
            INSERT INTO precio_venta_config (sku, margen_pct, ajuste_pct, precio_venta_clp, precio_final_clp, updated_at)
            VALUES (:sku, :margen_pct, :ajuste_pct, :precio_venta_clp, :precio_final_clp, NOW())
            ON CONFLICT (sku) DO UPDATE SET
                margen_pct       = EXCLUDED.margen_pct,
                ajuste_pct       = EXCLUDED.ajuste_pct,
                precio_venta_clp = EXCLUDED.precio_venta_clp,
                precio_final_clp = EXCLUDED.precio_final_clp,
                updated_at       = NOW()
        """), {
            "sku": sku, "margen_pct": margen_pct, "ajuste_pct": ajuste_pct,
            "precio_venta_clp": precio_venta_clp, "precio_final_clp": precio_final_clp,
        })
        count += 1
    db.commit()
    return {"actualizado": count, "margen_pct": margen_pct, "ajuste_pct": ajuste_pct}


@router.post("/masivo/precio-venta/reset", response_model=Dict)
def masivo_reset_precio_venta(payload: Dict, db: Session = Depends(get_db)):
    """Elimina overrides de precio de venta para una lista de SKUs."""
    skus = payload.get("skus", [])
    if not skus:
        return {"eliminado": 0}
    placeholders = ", ".join(f":s{i}" for i in range(len(skus)))
    params = {f"s{i}": skus[i] for i in range(len(skus))}
    result = db.execute(text(f"DELETE FROM precio_venta_config WHERE sku IN ({placeholders})"), params)
    db.commit()
    return {"eliminado": result.rowcount}


@router.get("/{sku}/precio-venta", response_model=Dict)
def get_precio_venta(sku: str, db: Session = Depends(get_db)):
    """Obtiene la configuración de precio de venta guardada para un SKU."""
    row = db.execute(
        text("SELECT * FROM precio_venta_config WHERE sku = :sku"), {"sku": sku}
    ).mappings().first()
    if not row:
        return {"sku": sku, "activo": False}
    return {
        "sku":              sku,
        "activo":           True,
        "margen_pct":       float(row["margen_pct"]),
        "ajuste_pct":       float(row["ajuste_pct"]),
        "precio_venta_clp": float(row["precio_venta_clp"]),
        "precio_final_clp": float(row["precio_final_clp"]),
    }

@router.put("/{sku}/precio-venta", response_model=Dict)
def set_precio_venta(sku: str, payload: Dict, db: Session = Depends(get_db)):
    """Guarda o actualiza el override de precio de venta para un SKU."""
    margen_pct       = float(payload.get("margen_pct", 0))
    ajuste_pct       = float(payload.get("ajuste_pct", 0))
    costo_final_clp  = float(payload.get("costo_final_clp", 0))

    precio_venta_clp = round(costo_final_clp * (1 + margen_pct / 100), 2)
    precio_final_clp = round(precio_venta_clp * (1 + ajuste_pct / 100), 2)

    db.execute(text("""
        INSERT INTO precio_venta_config (sku, margen_pct, ajuste_pct, precio_venta_clp, precio_final_clp, updated_at)
        VALUES (:sku, :margen_pct, :ajuste_pct, :precio_venta_clp, :precio_final_clp, NOW())
        ON CONFLICT (sku) DO UPDATE SET
            margen_pct       = EXCLUDED.margen_pct,
            ajuste_pct       = EXCLUDED.ajuste_pct,
            precio_venta_clp = EXCLUDED.precio_venta_clp,
            precio_final_clp = EXCLUDED.precio_final_clp,
            updated_at       = NOW()
    """), {
        "sku": sku, "margen_pct": margen_pct, "ajuste_pct": ajuste_pct,
        "precio_venta_clp": precio_venta_clp, "precio_final_clp": precio_final_clp,
    })
    db.commit()
    return {
        "sku":              sku,
        "activo":           True,
        "margen_pct":       margen_pct,
        "ajuste_pct":       ajuste_pct,
        "precio_venta_clp": precio_venta_clp,
        "precio_final_clp": precio_final_clp,
    }

@router.delete("/{sku}/precio-venta", response_model=Dict)
def delete_precio_venta(sku: str, db: Session = Depends(get_db)):
    """Elimina el override — el sistema vuelve a usar el costo_final_clp original."""
    db.execute(text("DELETE FROM precio_venta_config WHERE sku = :sku"), {"sku": sku})
    db.commit()
    return {"sku": sku, "activo": False}


# ---------------------------------------------------------------------------
# Historial de Escenarios de Receta
# ---------------------------------------------------------------------------

@router.get("/escenarios-receta", response_model=List[Dict])
def listar_escenarios(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT id, nombre, sku, nombre_sku, modo,
               costo_original_clp, costo_simulado_clp, variacion_pct,
               insumos_json, created_at
        FROM escenarios_receta
        ORDER BY created_at DESC
        LIMIT 50
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/escenarios-receta", response_model=Dict)
def guardar_escenario(payload: Dict, db: Session = Depends(get_db)):
    import json
    db.execute(text("""
        INSERT INTO escenarios_receta
            (nombre, sku, nombre_sku, modo, costo_original_clp, costo_simulado_clp, variacion_pct, insumos_json)
        VALUES
            (:nombre, :sku, :nombre_sku, :modo, :costo_original, :costo_simulado, :variacion_pct, :insumos_json)
    """), {
        "nombre":         payload.get("nombre", "Sin nombre"),
        "sku":            payload.get("sku"),
        "nombre_sku":     payload.get("nombre_sku"),
        "modo":           payload.get("modo", "existente"),
        "costo_original": payload.get("costo_original_clp"),
        "costo_simulado": payload.get("costo_simulado_clp"),
        "variacion_pct":  payload.get("variacion_pct"),
        "insumos_json":   json.dumps(payload.get("insumos", {})),
    })
    db.commit()
    return {"status": "ok"}


@router.delete("/escenarios-receta/{esc_id}", response_model=Dict)
def eliminar_escenario(esc_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM escenarios_receta WHERE id = :id"), {"id": esc_id})
    db.commit()
    return {"status": "ok", "id": esc_id}
