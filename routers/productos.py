import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from models import CondicionProducto, HistorialCostoItem
from typing import List

logger = logging.getLogger("passol.routers.productos")

router_productos = APIRouter(prefix="/api/productos", tags=["Productos"])

@router_productos.get("/{sku}/ficha", response_model=CondicionProducto)
def get_ficha(sku: str, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM condiciones_producto WHERE sku = :sku"),
        {"sku": sku}
    ).fetchone()
    if not row:
        return CondicionProducto(sku=sku)
    d = dict(row._mapping)
    return CondicionProducto(
        sku=d["sku"],
        precio_venta_sugerido=d.get("precio_venta_sugerido"),
        precio_piso=d.get("precio_piso"),
        margen_objetivo_pct=d.get("margen_objetivo_pct"),
        clasificacion=d.get("clasificacion"),
        notas=d.get("notas"),
    )

@router_productos.put("/{sku}/ficha", response_model=CondicionProducto)
def upsert_ficha(sku: str, payload: CondicionProducto, db: Session = Depends(get_db)):
    if payload.sku and payload.sku != sku:
        raise HTTPException(status_code=400, detail="El SKU del cuerpo no coincide con el SKU de la URL.")
    try:
        db.execute(text("""
            INSERT INTO condiciones_producto
                (sku, precio_venta_sugerido, precio_piso, margen_objetivo_pct, clasificacion, notas, updated_at)
            VALUES
                (:sku, :precio_venta_sugerido, :precio_piso, :margen_objetivo_pct, :clasificacion, :notas, NOW())
            ON CONFLICT (sku) DO UPDATE SET
                precio_venta_sugerido = EXCLUDED.precio_venta_sugerido,
                precio_piso           = EXCLUDED.precio_piso,
                margen_objetivo_pct   = EXCLUDED.margen_objetivo_pct,
                clasificacion         = EXCLUDED.clasificacion,
                notas                 = EXCLUDED.notas,
                updated_at            = NOW()
        """), {
            "sku": sku,
            "precio_venta_sugerido": payload.precio_venta_sugerido,
            "precio_piso":           payload.precio_piso,
            "margen_objetivo_pct":   payload.margen_objetivo_pct,
            "clasificacion":         payload.clasificacion,
            "notas":                 payload.notas,
        })
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"upsert_ficha sku={sku}: {e}", exc_info=True)
        msg = str(e).lower()
        if "foreign key" in msg or "violates" in msg:
            raise HTTPException(status_code=400, detail=f"El SKU '{sku}' no existe en el catálogo de productos.")
        raise HTTPException(status_code=500, detail="Error interno al guardar la ficha. Revisa logs/app.log.")
    payload.sku = sku
    return payload

HISTORIAL_QUERY = """
    SELECT
        ch.fecha_compra::text  AS fecha,
        ch.costo_unitario      AS costo_unitario_clp,
        CASE WHEN tc.valor_usd > 0
             THEN ROUND(ch.costo_unitario / tc.valor_usd, 6)
             ELSE 0 END        AS costo_unitario_usd,
        'compra'               AS fuente,
        ch.proveedor,
        NULL::varchar          AS insumo_sku,
        NULL::varchar          AS insumo_nombre
    FROM costos_historicos ch
    LEFT JOIN LATERAL (
        SELECT valor_usd FROM tipos_cambio
        WHERE fecha <= ch.fecha_compra
        ORDER BY fecha DESC LIMIT 1
    ) tc ON true
    WHERE ch.sku = :sku
    ORDER BY ch.fecha_compra DESC
    LIMIT 50
"""

HISTORIAL_BOM_QUERY = """
    SELECT
        ch.fecha_compra::text  AS fecha,
        ch.costo_unitario      AS costo_unitario_clp,
        CASE WHEN tc.valor_usd > 0
             THEN ROUND(ch.costo_unitario / tc.valor_usd, 6)
             ELSE 0 END        AS costo_unitario_usd,
        'compra'               AS fuente,
        ch.proveedor,
        ch.sku                 AS insumo_sku,
        m.nombre               AS insumo_nombre
    FROM recetas_bom rb
    JOIN costos_historicos ch ON ch.sku = rb.sku_hijo
    JOIN maestro_skus m ON m.sku = rb.sku_hijo
    LEFT JOIN LATERAL (
        SELECT valor_usd FROM tipos_cambio
        WHERE fecha <= ch.fecha_compra
        ORDER BY fecha DESC LIMIT 1
    ) tc ON true
    WHERE rb.sku_padre = :sku
    ORDER BY ch.fecha_compra DESC
    LIMIT 100
"""


@router_productos.get("/{sku}/historial", response_model=List[HistorialCostoItem])
def get_historial(sku: str, db: Session = Depends(get_db)):
    rows = db.execute(text(HISTORIAL_QUERY), {"sku": sku}).fetchall()

    # If no direct purchase records, fall back to BOM ingredient history
    if not rows:
        rows = db.execute(text(HISTORIAL_BOM_QUERY), {"sku": sku}).fetchall()

    result = []
    for r in rows:
        d = dict(r._mapping)
        result.append(HistorialCostoItem(
            fecha=d["fecha"],
            costo_unitario_clp=float(d["costo_unitario_clp"] or 0),
            costo_unitario_usd=float(d["costo_unitario_usd"] or 0),
            fuente=d["fuente"],
            proveedor=d.get("proveedor"),
            insumo_sku=d.get("insumo_sku"),
            insumo_nombre=d.get("insumo_nombre"),
        ))
    return result
