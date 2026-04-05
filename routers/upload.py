import logging
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from services.excel_processor import procesar_excel

logger = logging.getLogger("passol.routers.upload")

router = APIRouter(prefix="/api/upload", tags=["Cargas Excel"])


def fix_moneda_duplicados(db: Session) -> dict:
    """
    Detecta y elimina registros en costos_historicos donde moneda='USD'
    pero existe un registro idéntico con moneda='CLP' (mismo sku, fecha, costo_unitario).
    Esto ocurre cuando el ERP exporta el mismo precio en ambas monedas,
    causando que vista_ultimo_costo multiplique el valor CLP por el tipo de cambio (~923x).
    Retorna: { skus_afectados, filas_eliminadas }
    """
    # Contar antes de eliminar
    count_skus = db.execute(text("""
        SELECT COUNT(DISTINCT ch_usd.sku)
        FROM costos_historicos ch_usd
        WHERE ch_usd.moneda = 'USD'
        AND EXISTS (
            SELECT 1 FROM costos_historicos ch_clp
            WHERE ch_clp.sku          = ch_usd.sku
            AND   ch_clp.moneda       = 'CLP'
            AND   ch_clp.fecha_compra = ch_usd.fecha_compra
            AND   ch_clp.costo_unitario = ch_usd.costo_unitario
        )
    """)).scalar() or 0

    count_rows = db.execute(text("""
        SELECT COUNT(*)
        FROM costos_historicos ch_usd
        WHERE ch_usd.moneda = 'USD'
        AND EXISTS (
            SELECT 1 FROM costos_historicos ch_clp
            WHERE ch_clp.sku          = ch_usd.sku
            AND   ch_clp.moneda       = 'CLP'
            AND   ch_clp.fecha_compra = ch_usd.fecha_compra
            AND   ch_clp.costo_unitario = ch_usd.costo_unitario
        )
    """)).scalar() or 0

    if count_rows > 0:
        db.execute(text("""
            DELETE FROM costos_historicos
            WHERE moneda = 'USD'
            AND EXISTS (
                SELECT 1 FROM costos_historicos ch_clp
                WHERE ch_clp.sku          = costos_historicos.sku
                AND   ch_clp.moneda       = 'CLP'
                AND   ch_clp.fecha_compra = costos_historicos.fecha_compra
                AND   ch_clp.costo_unitario = costos_historicos.costo_unitario
            )
        """))
        db.commit()

    return {
        "skus_afectados": int(count_skus),
        "filas_eliminadas": int(count_rows),
    }


@router.post("/excel")
async def upload_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="El archivo debe ser un Excel (.xlsx, .xls)")

    contenido = await file.read()
    procesar_excel(contenido, db)

    # Corrección automática de duplicados moneda post-import
    fix_result = fix_moneda_duplicados(db)

    return {
        "status": "ok",
        "message": f"Datos procesados correctamente de {file.filename}",
        "recalculo": fix_result,
    }


@router.post("/recalcular")
def recalcular_costos(db: Session = Depends(get_db)):
    """
    Detecta y corrige inconsistencias de moneda en costos_historicos.
    Puede ejecutarse manualmente en cualquier momento desde el módulo de Importación.
    """
    result = fix_moneda_duplicados(db)
    return {
        "status": "ok",
        "skus_afectados": result["skus_afectados"],
        "filas_eliminadas": result["filas_eliminadas"],
        "message": (
            f"Se corrigieron {result['filas_eliminadas']} registros en {result['skus_afectados']} SKUs."
            if result["filas_eliminadas"] > 0
            else "Sin inconsistencias detectadas. Los costos están correctos."
        ),
    }


@router.post("/google-sheets")
def sincronizar_google_sheets(db: Session = Depends(get_db)):
    """
    Lee el Google Sheet configurado en .env (GOOGLE_SHEET_ID) y sincroniza
    los datos en PostgreSQL usando los mismos procesadores que el upload Excel.
    """
    import os
    from services.google_sheets import sincronizar_desde_google_sheets

    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not sheet_id:
        raise HTTPException(
            status_code=400,
            detail="GOOGLE_SHEET_ID no está configurado en el archivo .env."
        )

    try:
        resumen = sincronizar_desde_google_sheets(sheet_id, db)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error sincronizando Google Sheets: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error al sincronizar: {e}"
        )

    procesadas = len(resumen["hojas_procesadas"])
    omitidas   = len(resumen["hojas_omitidas"])
    errores    = resumen["errores"]

    if procesadas == 0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"No se reconoció ninguna hoja. "
                f"Hojas encontradas: {resumen['hojas_encontradas']}. "
                "Los nombres deben contener: sku, maestro, receta, bom, compra, importacion o cambio."
            )
        )

    return {
        "status": "ok",
        "hojas_procesadas": resumen["hojas_procesadas"],
        "hojas_omitidas":   resumen["hojas_omitidas"],
        "errores":          errores,
        "mensaje": (
            f"Sincronización exitosa: {procesadas} hoja(s) importada(s)"
            + (f", {omitidas} omitida(s)" if omitidas else "")
            + (f", {len(errores)} error(es)" if errores else "")
            + "."
        ),
    }
