"""
services/google_sheets.py
Lectura de Google Sheets como DataFrames de pandas.
Usa las mismas funciones de procesamiento que excel_processor.py.
"""
import logging
import os
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("passol.google_sheets")

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _get_client() -> gspread.Client:
    """Autentica con la cuenta de servicio y retorna el cliente gspread."""
    creds_path = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    # Resolver ruta relativa desde la raíz del proyecto
    if not os.path.isabs(creds_path):
        creds_path = os.path.join(os.path.dirname(__file__), "..", creds_path)
    creds_path = os.path.normpath(creds_path)

    if not os.path.exists(creds_path):
        raise FileNotFoundError(
            f"No se encontró el archivo de credenciales: {creds_path}\n"
            "Coloca credentials.json en la raíz del proyecto."
        )

    creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    return gspread.authorize(creds)


def leer_sheet_como_dataframes(sheet_id: str) -> dict[str, pd.DataFrame]:
    """
    Abre el Google Sheet por ID y retorna un dict {nombre_hoja: DataFrame}.
    Equivalente a pd.read_excel con sheet_name=None.
    """
    client = _get_client()

    try:
        spreadsheet = client.open_by_key(sheet_id)
    except gspread.exceptions.SpreadsheetNotFound:
        raise PermissionError(
            f"No se puede acceder al sheet '{sheet_id}'.\n"
            "Verifica que fue compartido con: "
            "passol-sync@warm-actor-464018-s9.iam.gserviceaccount.com"
        )
    except gspread.exceptions.APIError as e:
        raise RuntimeError(f"Error de Google Sheets API: {e}")

    resultado: dict[str, pd.DataFrame] = {}

    for worksheet in spreadsheet.worksheets():
        nombre = worksheet.title
        logger.info(f"Leyendo hoja: '{nombre}'")

        try:
            datos = worksheet.get_all_values()
            if not datos or len(datos) < 2:
                logger.warning(f"Hoja '{nombre}' vacía o sin filas de datos — omitida.")
                continue

            headers = datos[0]
            rows    = datos[1:]

            # Normalizar headers: minúsculas, sin tildes, espacios → guión bajo
            def _norm(h: str) -> str:
                return (str(h).strip().lower()
                        .replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '')
                        .replace('ó','o').replace('á','a').replace('é','e')
                        .replace('í','i').replace('ú','u').replace('ñ','n'))

            headers_norm = [_norm(h) for h in headers]

            # Deduplicar columnas (si hay headers repetidos → col, col_1, col_2 ...)
            seen: dict[str, int] = {}
            dedup: list[str] = []
            for h in headers_norm:
                if h in seen:
                    seen[h] += 1
                    dedup.append(f"{h}_{seen[h]}")
                else:
                    seen[h] = 0
                    dedup.append(h)
            headers_norm = dedup

            df = pd.DataFrame(rows, columns=headers_norm)

            # Convertir celdas vacías a NaN
            df.replace('', pd.NA, inplace=True)

            # Limpiar strings (quitar espacios extra) — NO convertir a numérico aquí;
            # los procesadores individuales hacen su propia conversión de tipos.
            for col in df.columns:
                df[col] = df[col].apply(
                    lambda x: x.strip() if isinstance(x, str) else x
                )

            resultado[nombre] = df
            logger.info(f"  → {len(df)} filas, {len(df.columns)} columnas: {list(df.columns)}")

        except Exception as e:
            logger.error(f"Error leyendo hoja '{nombre}': {e}", exc_info=True)
            # No abortar — continuar con las demás hojas
            continue

    if not resultado:
        raise ValueError("El Google Sheet no contiene hojas con datos válidos.")

    return resultado


def sincronizar_desde_google_sheets(sheet_id: str, db) -> dict:
    """
    Lee el Google Sheet y ejecuta los mismos procesadores que el upload Excel.
    Retorna un resumen de lo procesado.
    """
    from services.excel_processor import (
        procesar_skus, procesar_factores, procesar_recetas,
        procesar_compras, procesar_tipos_cambio, procesar_costos_impo,
        procesar_ley_rep,
    )

    dataframes = leer_sheet_como_dataframes(sheet_id)
    resumen = {
        "hojas_encontradas": list(dataframes.keys()),
        "hojas_procesadas": [],
        "hojas_omitidas":   [],
        "errores":          [],
    }

    for nombre_hoja, df in dataframes.items():
        nombre_lower = nombre_hoja.lower().strip()
        procesado = False

        # Cada hoja se procesa en su propio SAVEPOINT para que un error
        # en una hoja no aborte la transacción completa.
        sp = f"sp_{nombre_lower.replace(' ', '_')}"
        try:
            db.execute(text(f"SAVEPOINT {sp}"))
        except Exception:
            pass  # Si el motor no soporta savepoints, continuar sin él

        try:
            if "maestro" in nombre_lower or ("sku" in nombre_lower and "maestro" not in nombre_lower):
                logger.info(f"Procesando Maestro SKUs desde hoja: '{nombre_hoja}'")
                procesar_skus(df, db)
                procesado = True

            elif "factor" in nombre_lower or "conversion" in nombre_lower:
                logger.info(f"Procesando Factores desde hoja: '{nombre_hoja}'")
                procesar_factores(df, db)
                procesado = True

            elif "receta" in nombre_lower or "bom" in nombre_lower or "estructura" in nombre_lower:
                logger.info(f"Procesando Recetas BOM desde hoja: '{nombre_hoja}'")
                procesar_recetas(df, db)
                procesado = True

            elif any(x in nombre_lower for x in ["importacion", "importaci", "costos impo", "impo"]):
                logger.info(f"Procesando Costos Importación desde hoja: '{nombre_hoja}'")
                procesar_costos_impo(df, db)
                procesado = True

            elif "compra" in nombre_lower:
                logger.info(f"Procesando Compras desde hoja: '{nombre_hoja}'")
                procesar_compras(df, db)
                procesado = True

            elif any(x in nombre_lower for x in ["cambio", "dolar", "usd", "tipo_cambio"]):
                logger.info(f"Procesando Tipos de Cambio desde hoja: '{nombre_hoja}'")
                procesar_tipos_cambio(df, db)
                procesado = True

            elif "ley" in nombre_lower or "rep" in nombre_lower:
                logger.info(f"Procesando Ley REP por SKU desde hoja: '{nombre_hoja}'")
                procesar_ley_rep(df, db)
                procesado = True

            # Confirmar el savepoint de esta hoja
            try:
                db.execute(text(f"RELEASE SAVEPOINT {sp}"))
            except Exception:
                pass

        except Exception as e:
            # Revertir solo esta hoja, las anteriores quedan intactas
            try:
                db.execute(text(f"ROLLBACK TO SAVEPOINT {sp}"))
            except Exception:
                db.rollback()
            msg = f"Error en hoja '{nombre_hoja}': {e}"
            logger.error(msg, exc_info=True)
            resumen["errores"].append(msg)
            continue

        if procesado:
            resumen["hojas_procesadas"].append(nombre_hoja)
        else:
            resumen["hojas_omitidas"].append(nombre_hoja)

    if resumen["hojas_procesadas"]:
        db.commit()
        logger.info(f"Sincronización completada. Procesadas: {resumen['hojas_procesadas']}")
    else:
        db.rollback()
        logger.warning("Ninguna hoja fue procesada. Revisa los nombres de las pestañas.")

    return resumen
