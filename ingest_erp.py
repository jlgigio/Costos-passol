import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import text
from database import engine

def clean_col_name(col):
    """Limpia los nombres de las columnas para evitar problemas de codificación y acentos, transformándolas a un string seguro."""
    if pd.isna(col): return ""
    return str(col).encode('ascii', 'ignore').decode('ascii').strip().lower()

def normalizar_sku(val):
    """Normaliza un SKU: convierte floats tipo '101315029.0' a '101315029'. Evita pérdida de datos por lectura numérica de pandas."""
    s = str(val).strip()
    try:
        return str(int(float(s)))
    except (ValueError, TypeError):
        return s

def importar_desde_excel(file_path="Base de datos.xlsx"):
    print(f"Iniciando ingesta de datos desde: {file_path}")
    
    try:
        xl = pd.ExcelFile(file_path)
    except Exception as e:
        print(f"Error al abrir el archivo Excel principal: {e}")
        return

    try:
        xl_codifica = pd.ExcelFile("Codifica (Productos Varios prueba).xlsm")
    except Exception as e:
        print(f"No se pudo cargar Excel de Codificación: {e}")
        xl_codifica = None

    # Mapeo de columnas sucias del ERP a columnas limpias funcionales de nuestro script Python
    MAPEO_COLUMNAS = {
        "maestro": {
            "nmero de artculo": "sku", 
            "numero de articulo": "sku",
            "descripcin del artculo": "nombre",
            "descripcion del articulo": "nombre",
            "unidad de medida de inventario": "unidad_medida",
            "tipo articulo": "tipo_erp"
        },
        "factor": {
            "code": "sku",
            "factor litros": "factor_litros"
        },
        "dolar": {
            "fecha de tipo de cambio": "fecha",
            "tipo de cambio": "valor_usd",
            "cdigo de moneda": "codigo_moneda",   # con acento removido por clean_col_name
            "codigo de moneda": "codigo_moneda"
        },
        "compras": {
            "nmero de artculo": "sku",
            "numero de articulo": "sku",
            "fecha de contabilizacin": "fecha_compra",
            "fecha de contabilizacion": "fecha_compra",
            "precio": "precio",
            "costo unitario": "precio",
            "tipo de cambio": "tipo_cambio",
            "moneda del precio": "moneda_precio",
            "nombre de cliente/proveedor": "proveedor"
        },
        "costos_importacion": {
            "nmero de artculo": "sku",
            "numero de articulo": "sku",
            "fecha de contabilizacin": "fecha_compra",
            "fecha de contabilizacion": "fecha_compra",
            "precio de almacn": "costo_unitario",  # precio de almacén = CLP/unidad de inventario
            "precio de almacen": "costo_unitario",
            "nombre de acreedor": "proveedor"
        },
        "receta": {
            "artculo superior": "sku_padre",
            "articulo superior": "sku_padre",
            "cdigo de componente": "sku_hijo",
            "codigo de componente": "sku_hijo",
            "cantidad": "cantidad",
            "lote base": "lote_base"
        }
    }

    # Helper para estandarizar el DataFrame
    def get_df_limpio(sheet_name, map_key):
        actual_sheet = next((s for s in xl.sheet_names if s.lower() == sheet_name.lower()), None)
        if not actual_sheet:
            print(f"Advertencia: Hoja '{sheet_name}' no encontrada en el Excel.")
            return None
        df = xl.parse(actual_sheet)
        # Limpiar columnas del df
        df.columns = [clean_col_name(c) for c in df.columns]
        
        # Renombrar usando el mapa (solo las que coincidan)
        df_rename = df.rename(columns=MAPEO_COLUMNAS.get(map_key, {}))
        # Remover columnas duplicadas (mantener la primera) para evitar convertir Series a float
        df_rename = df_rename.loc[:,~df_rename.columns.duplicated()]
        return df_rename

    with engine.begin() as conn:

        # ---------------------------------------------------------
        # 1. MAESTRO DÓLAR (tipos_cambio)
        # ---------------------------------------------------------
        df_dolar = get_df_limpio("dolar", "dolar")
        if df_dolar is not None and "fecha" in df_dolar.columns and "valor_usd" in df_dolar.columns:
            print("Importando Tipos de Cambio (Dólar)...")
            df_dolar = df_dolar.dropna(subset=["fecha", "valor_usd"])
            # Filtrar SOLO filas USD para evitar contaminación con EUR u otras monedas
            if "codigo_moneda" in df_dolar.columns:
                df_dolar = df_dolar[df_dolar["codigo_moneda"].astype(str).str.strip().str.upper() == "USD"]
                print(f"  >> Filtrado por codigo USD: {len(df_dolar)} registros")
            else:
                print("  AVISO: Columna 'codigo de moneda' no encontrada -- importando todo sin filtro")
            df_dolar["fecha"] = pd.to_datetime(df_dolar["fecha"], errors='coerce')
            # TRUNCATE para reemplazar con datos limpios cada vez
            conn.execute(text("TRUNCATE TABLE tipos_cambio"))
            for _, row in df_dolar.dropna(subset=["fecha"]).iterrows():
                conn.execute(
                    text("INSERT INTO tipos_cambio (fecha, valor_usd) VALUES (:fecha, :valor) ON CONFLICT DO NOTHING"),
                    {"fecha": row["fecha"].date(), "valor": float(row["valor_usd"])}
                )

        # ---------------------------------------------------------
        # 2. MAESTRO SKUS (maestro_skus)
        # ---------------------------------------------------------
        df_maestro = get_df_limpio("maestro", "maestro")
        if df_maestro is not None and "sku" in df_maestro.columns:
            print("Importando Maestro de SKUs...")
            df_maestro = df_maestro.dropna(subset=["sku", "nombre"])
            for _, row in df_maestro.iterrows():
                tipo_erp = str(row.get("tipo_erp", "")).strip().upper()
                tipo_bd = "Insumo"  # Por defecto
                if "PRODUCTO FINAL" in tipo_erp or "TERMINADO" in tipo_erp:
                    tipo_bd = "Producto Terminado"
                elif "SUBRECETA" in tipo_erp or "SUB-RECETA" in tipo_erp or "SEMI" in tipo_erp:
                    tipo_bd = "Sub-receta"

                conn.execute(
                    text("""
                        INSERT INTO maestro_skus (sku, nombre, tipo, unidad_medida) 
                        VALUES (:sku, :nombre, :tipo, :unidad_medida) 
                        ON CONFLICT (sku) DO UPDATE SET 
                            nombre = EXCLUDED.nombre,
                            tipo = EXCLUDED.tipo,
                            unidad_medida = EXCLUDED.unidad_medida
                    """),
                    {
                        "sku": normalizar_sku(row["sku"]),
                        "nombre": str(row["nombre"]).strip(),
                        "tipo": tipo_bd,
                        "unidad_medida": str(row.get("unidad_medida", "Unidad")).strip()
                    }
                )

        # ---------------------------------------------------------
        # 3. FACTORES CONVERSIÓN (factores_conversion)
        # ---------------------------------------------------------
        df_factor = get_df_limpio("factor", "factor")
        if df_factor is not None and "sku" in df_factor.columns:
            print("Importando Factores de Conversión...")
            df_factor = df_factor.dropna(subset=["sku", "factor_litros"])
            for _, row in df_factor.iterrows():
                conn.execute(
                    text("""
                        INSERT INTO factores_conversion (sku, factor_multiplicador, tipo_factor) 
                        SELECT :sku, :factor, :tipo
                        WHERE EXISTS (SELECT 1 FROM maestro_skus WHERE sku = :sku)
                        ON CONFLICT (sku) DO UPDATE SET factor_multiplicador = EXCLUDED.factor_multiplicador
                    """),
                    {
                        "sku": normalizar_sku(row["sku"]),
                        "factor": float(row["factor_litros"]),
                        "tipo": "Litros"
                    }
                )

        # ---------------------------------------------------------
        # 4. COMPRAS (costos_historicos - convertido siempre a CLP)
        # ---------------------------------------------------------
        # REGLA: columna J = "precio" (precio en moneda de transacción)
        #        columna K = "tipo de cambio" (TC del día de la compra)
        #        columna "moneda del precio" = 'USD' o 'CLP'
        # Si USD: costo_clp = precio × tipo_cambio
        # Si CLP: costo_clp = precio  (ya está en CLP)
        # Almacenamos todo como moneda='CLP' — sin conversión posterior en la vista
        df_compras = get_df_limpio("compras", "compras")
        if df_compras is not None and "sku" in df_compras.columns:
            print("Importando Compras (conversión automática a CLP)...")
            df_compras = df_compras.dropna(subset=["sku", "fecha_compra", "precio"])
            df_compras["fecha_compra"] = pd.to_datetime(df_compras["fecha_compra"], errors='coerce')

            # Asegurar columnas auxiliares con defaults seguros
            if "tipo_cambio" not in df_compras.columns:
                df_compras["tipo_cambio"] = 1.0
            if "moneda_precio" not in df_compras.columns:
                df_compras["moneda_precio"] = "CLP"

            df_compras["tipo_cambio"] = pd.to_numeric(df_compras["tipo_cambio"], errors='coerce').fillna(1.0)
            df_compras["precio"] = pd.to_numeric(df_compras["precio"], errors='coerce')
            df_compras = df_compras.dropna(subset=["precio"])

            n_usd, n_clp = 0, 0
            for _, row in df_compras.dropna(subset=["fecha_compra"]).iterrows():
                moneda = str(row.get("moneda_precio", "CLP")).strip().upper()
                precio = float(row["precio"])
                tc = float(row["tipo_cambio"]) if float(row["tipo_cambio"]) > 0 else 1.0

                # Convertir a CLP
                if moneda == "USD":
                    costo_clp = precio * tc
                    n_usd += 1
                else:
                    costo_clp = precio
                    n_clp += 1

                conn.execute(
                    text("""
                        INSERT INTO costos_historicos (sku, fecha_compra, costo_unitario, moneda, proveedor)
                        SELECT :sku, :fecha, :costo, 'CLP', :proveedor
                        WHERE EXISTS (SELECT 1 FROM maestro_skus WHERE sku = :sku)
                    """),
                    {
                        "sku": normalizar_sku(row["sku"]),
                        "fecha": row["fecha_compra"].date(),
                        "costo": costo_clp,
                        "proveedor": str(row.get("proveedor", "")).strip()
                    }
                )
            print(f"  >> {n_clp} compras CLP + {n_usd} compras USD convertidas a CLP")

        # ---------------------------------------------------------
        # 5. COSTOS IMPORTACIÓN (costos_historicos - CLP via precio_almacen)
        # ---------------------------------------------------------
        # REGLA: "precio de almacén" = total_linea / cantidad = CLP por unidad de inventario
        # Ya está en CLP, NO necesita conversión de tipo de cambio.
        df_impo = get_df_limpio("Costos importacion", "costos_importacion")
        if df_impo is not None and "sku" in df_impo.columns:
            print("Importando Costos de Importación (precio_almacen directo en CLP)...")
            df_impo = df_impo.dropna(subset=["sku", "fecha_compra", "costo_unitario"])
            df_impo["fecha_compra"] = pd.to_datetime(df_impo["fecha_compra"], errors='coerce')
            df_impo["costo_unitario"] = pd.to_numeric(df_impo["costo_unitario"], errors='coerce')
            df_impo = df_impo.dropna(subset=["costo_unitario"])
            for _, row in df_impo.dropna(subset=["fecha_compra"]).iterrows():
                conn.execute(
                    text("""
                        INSERT INTO costos_historicos (sku, fecha_compra, costo_unitario, moneda, proveedor)
                        SELECT :sku, :fecha, :costo, 'CLP', :proveedor
                        WHERE EXISTS (SELECT 1 FROM maestro_skus WHERE sku = :sku)
                    """),
                    {
                        "sku": normalizar_sku(row["sku"]),
                        "fecha": row["fecha_compra"].date(),
                        "costo": float(row["costo_unitario"]),
                        "proveedor": str(row.get("proveedor", "")).strip()
                    }
                )

        # ---------------------------------------------------------
        # 6. RECETA / BOM (recetas_bom) DIVIDIENDO POR LOTE BASE
        # ---------------------------------------------------------
        df_receta = get_df_limpio("receta", "receta")
        if df_receta is not None and "sku_padre" in df_receta.columns:
            print("Importando Recetas (BOM) y dividiendo cantidad por Lote Base...")
            
            # Limpiar primero toda la tabla de recetas para que se reemplace por el snapshot más reciente del ERP
            conn.execute(text("TRUNCATE TABLE recetas_bom RESTART IDENTITY"))

            df_receta = df_receta.dropna(subset=["sku_padre", "sku_hijo", "cantidad", "lote_base"])
            for _, row in df_receta.iterrows():
                lote_base = float(row["lote_base"])
                cantidad_bruta = float(row["cantidad"])
                
                # REGLA DE NEGOCIO: Dividir por lote base
                cantidad_neta = cantidad_bruta / lote_base if lote_base > 0 else cantidad_bruta
                
                # Asumimos merma en 0, si tienes columna merma en el ERP la agregamos después
                conn.execute(
                    text("""
                        INSERT INTO recetas_bom (sku_padre, sku_hijo, cantidad_neta, porcentaje_merma) 
                        SELECT :padre, :hijo, :cantidad, 0.0
                        WHERE EXISTS (SELECT 1 FROM maestro_skus WHERE sku = :padre) 
                          AND EXISTS (SELECT 1 FROM maestro_skus WHERE sku = :hijo)
                        ON CONFLICT DO NOTHING
                    """),
                    {
                        "padre": normalizar_sku(row["sku_padre"]),
                        "hijo": normalizar_sku(row["sku_hijo"]),
                        "cantidad": cantidad_neta
                    }
                )

        # ---------------------------------------------------------
        # 7. PARÁMETROS COMERCIALES (ley rep)
        # ---------------------------------------------------------
        if xl_codifica and "ley rep" in xl_codifica.sheet_names:
            print("Importando Ley REP (Parámetros Comerciales)...")
            df_ley_rep = xl_codifica.parse("ley rep")
            col_rep = [c for c in df_ley_rep.columns if "REP" in str(c).upper() and "KG" in str(c).upper()]
            if col_rep:
                val_rep = df_ley_rep[col_rep[0]].dropna().mean()
                try:
                    conn.execute(text("""
                        UPDATE parametros_comerciales SET ley_rep_por_kilo = :val WHERE id = 1
                    """), {"val": float(val_rep)})
                except Exception as e:
                    print(f"Aviso al actualizar Ley REP (quizás la tabla no existe o es diferente): {e}")

        # ---------------------------------------------------------
        # 8. CLIENTES (PARA CONSULTA)
        # ---------------------------------------------------------
        if xl_codifica and "PARA CONSULTA" in xl_codifica.sheet_names:
            print("Importando Clientes desde PARA CONSULTA...")
            df_consulta = xl_codifica.parse("PARA CONSULTA", nrows=5)
            # En PARA CONSULTA, los clientes están en la fila 0 de las columnas sin nombre al principio
            # Busquemos los strings que parecen clientes
            clientes_encontrados = []
            for col in df_consulta.columns:
                val_fila0 = df_consulta.at[0, col]
                if isinstance(val_fila0, str):
                    val = val_fila0.strip()
                    if val and val not in ["NOMBRE", "CODIGO", "MP+INSUMOS+ENVASE", "Peso", "Terreno"]:
                        clientes_encontrados.append(val)
                        
            for cliente in clientes_encontrados:
                try:
                    conn.execute(text("""
                        INSERT INTO clientes_condiciones (cliente) 
                        SELECT :cli WHERE NOT EXISTS (SELECT 1 FROM clientes_condiciones WHERE cliente = :cli)
                    """), {"cli": cliente})
                except Exception as e:
                    print(f"Aviso al insertar cliente {cliente}: {e}")

        # ---------------------------------------------------------
        # 9. RECLASIFICACIÓN AUTOMÁTICA DE TIPOS POR TOPOLOGÍA BOM
        # ---------------------------------------------------------
        # Producto Terminado = raíz del BOM (padre sin ser hijo)
        # Sub-receta         = nodo intermedio (padre Y hijo)
        # Insumo             = hoja (solo hijo, o sin relación)
        print("Reclasificando tipos en maestro_skus según topología BOM...")
        conn.execute(text("""
            UPDATE maestro_skus SET tipo =
                CASE
                    WHEN sku IN (SELECT DISTINCT sku_padre FROM recetas_bom)
                     AND sku NOT IN (SELECT DISTINCT sku_hijo FROM recetas_bom)
                    THEN 'Producto Terminado'
                    WHEN sku IN (SELECT DISTINCT sku_padre FROM recetas_bom)
                     AND sku IN (SELECT DISTINCT sku_hijo FROM recetas_bom)
                    THEN 'Sub-receta'
                    ELSE 'Insumo'
                END
        """))

    print("\n¡Proceso de Ingesta de ERP y Archivos Adicionales Finalizado con Éxito!")

if __name__ == "__main__":
    load_dotenv()
    importar_desde_excel()
