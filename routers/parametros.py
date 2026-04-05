from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from models import ParametrosComerciales, LeyRepFormato, ClienteCondicionCreate, ClienteCondicionResponse
from typing import List, Dict

# ── Parámetros comerciales ─────────────────────────────────────────────────
router_params = APIRouter(prefix="/api/parametros", tags=["Parámetros"])

@router_params.get("/", response_model=ParametrosComerciales)
def get_parametros(db: Session = Depends(get_db)):
    row = db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No se encontraron parámetros.")
    d = dict(row._mapping)
    return ParametrosComerciales(
        ley_rep_por_kilo=float(d.get("ley_rep_por_kilo", 0)),
        disposicion_por_kilo=float(d.get("disposicion_por_kilo", 0)),
        gastos_indirectos_porcentaje=float(d.get("gastos_indirectos_porcentaje", 0)),
        comision_porcentaje=float(d.get("comision_porcentaje", 0)),
        merma_global_factor=float(d.get("merma_global_factor", 1)),
        costo_flete_base_kilo=float(d.get("costo_flete_base_kilo", 0)),
        costo_pallet_base_kilo=float(d.get("costo_pallet_base_kilo", 0)),
        tipo_cambio_usd=float(d.get("tipo_cambio_usd", 950)),
        tipo_cambio_eur=float(d.get("tipo_cambio_eur", 0)),
        valor_uf=float(d.get("valor_uf", 37000)),
    )

@router_params.put("/", response_model=ParametrosComerciales)
def update_parametros(payload: ParametrosComerciales, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE parametros_comerciales SET
            ley_rep_por_kilo             = :ley_rep_por_kilo,
            disposicion_por_kilo         = :disposicion_por_kilo,
            gastos_indirectos_porcentaje = :gastos_indirectos_porcentaje,
            comision_porcentaje          = :comision_porcentaje,
            merma_global_factor          = :merma_global_factor,
            costo_flete_base_kilo        = :costo_flete_base_kilo,
            costo_pallet_base_kilo       = :costo_pallet_base_kilo,
            tipo_cambio_usd              = :tipo_cambio_usd,
            tipo_cambio_eur              = :tipo_cambio_eur,
            valor_uf                     = :valor_uf
        WHERE id = 1
    """), payload.model_dump())
    db.commit()
    return payload


@router_params.post("/tipo-cambio", response_model=Dict)
def guardar_tipo_cambio(payload: Dict, db: Session = Depends(get_db)):
    """Guarda USD y EUR en tipos_cambio y actualiza parametros_comerciales."""
    usd = float(payload.get("usd", 0))
    eur = float(payload.get("eur", 0))
    fecha = payload.get("fecha")  # YYYY-MM-DD string o None
    from datetime import date
    fecha_val = fecha if fecha else str(date.today())
    # Insertar/actualizar en tipos_cambio
    db.execute(text("""
        INSERT INTO tipos_cambio (fecha, valor_usd, valor_eur)
        VALUES (:fecha, :usd, :eur)
        ON CONFLICT (fecha) DO UPDATE SET valor_usd = EXCLUDED.valor_usd, valor_eur = EXCLUDED.valor_eur
    """), {"fecha": fecha_val, "usd": usd, "eur": eur})
    # Sincronizar parametros_comerciales
    if usd > 0:
        db.execute(text("UPDATE parametros_comerciales SET tipo_cambio_usd = :usd WHERE id = 1"), {"usd": usd})
    if eur > 0:
        db.execute(text("UPDATE parametros_comerciales SET tipo_cambio_eur = :eur WHERE id = 1"), {"eur": eur})
    db.commit()
    return {"status": "ok", "fecha": fecha_val, "usd": usd, "eur": eur}


# ── Ley REP por Formato ────────────────────────────────────────────────────
router_ley_rep = APIRouter(prefix="/api/parametros/ley-rep", tags=["Parámetros"])

@router_ley_rep.get("/", response_model=List[LeyRepFormato])
def listar_ley_rep(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, formato, uf_por_formato FROM ley_rep_formatos ORDER BY formato")).fetchall()
    return [dict(r._mapping) for r in rows]

@router_ley_rep.post("/", response_model=LeyRepFormato)
def crear_ley_rep(payload: LeyRepFormato, db: Session = Depends(get_db)):
    result = db.execute(text("""
        INSERT INTO ley_rep_formatos (formato, uf_por_formato)
        VALUES (:formato, :uf_por_formato)
        ON CONFLICT (formato) DO UPDATE SET uf_por_formato = EXCLUDED.uf_por_formato, updated_at = NOW()
        RETURNING id, formato, uf_por_formato
    """), {"formato": payload.formato, "uf_por_formato": payload.uf_por_formato})
    db.commit()
    return dict(result.fetchone()._mapping)

@router_ley_rep.put("/{id}", response_model=LeyRepFormato)
def actualizar_ley_rep(id: int, payload: LeyRepFormato, db: Session = Depends(get_db)):
    result = db.execute(text("""
        UPDATE ley_rep_formatos SET formato = :formato, uf_por_formato = :uf_por_formato, updated_at = NOW()
        WHERE id = :id RETURNING id, formato, uf_por_formato
    """), {"formato": payload.formato, "uf_por_formato": payload.uf_por_formato, "id": id})
    db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Registro {id} no encontrado.")
    return dict(row._mapping)

@router_ley_rep.get("/productos")
def ley_rep_productos(db: Session = Depends(get_db)):
    """Todos los PTs con su valor Ley REP en CLP (por SKU desde ley_rep_skus)."""
    rows = db.execute(text("""
        SELECT
            m.sku,
            m.nombre,
            m.unidad_medida  AS formato,
            lrs.ley_rep_clp
        FROM maestro_skus m
        LEFT JOIN ley_rep_skus lrs ON lrs.sku = m.sku
        WHERE m.tipo = 'Producto Terminado'
        ORDER BY m.unidad_medida, m.nombre
    """)).fetchall()
    return [dict(r._mapping) for r in rows]

@router_ley_rep.put("/skus/{sku}")
def actualizar_ley_rep_sku(sku: str, payload: Dict, db: Session = Depends(get_db)):
    """Actualiza o inserta el valor CLP Ley REP para un SKU específico."""
    clp = float(payload.get("ley_rep_clp", 0))
    db.execute(text("""
        INSERT INTO ley_rep_skus (sku, ley_rep_clp)
        VALUES (:sku, :clp)
        ON CONFLICT (sku) DO UPDATE SET ley_rep_clp = EXCLUDED.ley_rep_clp, updated_at = NOW()
    """), {"sku": sku, "clp": clp})
    db.commit()
    return {"sku": sku, "ley_rep_clp": clp}

@router_ley_rep.delete("/{id}")
def eliminar_ley_rep(id: int, db: Session = Depends(get_db)):
    result = db.execute(text("DELETE FROM ley_rep_formatos WHERE id = :id"), {"id": id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Registro {id} no encontrado.")
    return {"status": "ok", "id": id}


# ── Costos Indirectos batch (flete + pallet por cliente) ──────────────────
@router_params.put("/costos-indirectos", response_model=Dict)
def update_costos_indirectos(payload: List[Dict], db: Session = Depends(get_db)):
    """Actualiza flete y pallet (agua/otros) para múltiples clientes en una sola llamada."""
    updated = 0
    for item in payload:
        db.execute(text("""
            UPDATE clientes_condiciones SET
                flete_agua_kilo  = :flete_agua_kilo,
                flete_otros_kilo = :flete_otros_kilo,
                pallet_agua_kilo = :pallet_agua_kilo,
                pallet_otros_kilo= :pallet_otros_kilo,
                flete_por_kilo   = :flete_agua_kilo
            WHERE id = :id
        """), item)
        updated += 1
    db.commit()
    return {"status": "ok", "updated": updated}


# ── Clientes / condiciones comerciales ────────────────────────────────────
router_clientes = APIRouter(prefix="/api/clientes", tags=["Clientes"])

@router_clientes.get("/", response_model=List[ClienteCondicionResponse])
def listar_clientes(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT * FROM clientes_condiciones ORDER BY id")).fetchall()
    return [dict(r._mapping) for r in rows]

@router_clientes.post("/", response_model=ClienteCondicionResponse)
def crear_cliente(payload: ClienteCondicionCreate, db: Session = Depends(get_db)):
    result = db.execute(text("""
        INSERT INTO clientes_condiciones
            (cliente, factor, descuento_max, comision_promedio, rapell, fee,
             marketing, x_docking, rebate, rebate_centralizacion,
             flete_por_kilo, flete_agua_kilo, flete_otros_kilo,
             pallet_agua_kilo, pallet_otros_kilo)
        VALUES
            (:cliente, :factor, :descuento_max, :comision_promedio, :rapell, :fee,
             :marketing, :x_docking, :rebate, :rebate_centralizacion,
             :flete_por_kilo, :flete_agua_kilo, :flete_otros_kilo,
             :pallet_agua_kilo, :pallet_otros_kilo)
        RETURNING *
    """), payload.model_dump())
    db.commit()
    return dict(result.fetchone()._mapping)

@router_clientes.put("/{id}", response_model=ClienteCondicionResponse)
def actualizar_cliente(id: int, payload: ClienteCondicionCreate, db: Session = Depends(get_db)):
    result = db.execute(text("""
        UPDATE clientes_condiciones SET
            cliente = :cliente, factor = :factor, descuento_max = :descuento_max,
            comision_promedio = :comision_promedio, rapell = :rapell, fee = :fee,
            marketing = :marketing, x_docking = :x_docking, rebate = :rebate,
            rebate_centralizacion = :rebate_centralizacion,
            flete_agua_kilo = :flete_agua_kilo, flete_otros_kilo = :flete_otros_kilo,
            pallet_agua_kilo = :pallet_agua_kilo, pallet_otros_kilo = :pallet_otros_kilo,
            flete_por_kilo = :flete_agua_kilo
        WHERE id = :id RETURNING *
    """), {**payload.model_dump(), "id": id})
    db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Cliente {id} no encontrado.")
    return dict(row._mapping)

@router_clientes.delete("/{id}")
def eliminar_cliente(id: int, db: Session = Depends(get_db)):
    result = db.execute(text("DELETE FROM clientes_condiciones WHERE id = :id"), {"id": id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Cliente {id} no encontrado.")
    return {"status": "ok", "id": id}
