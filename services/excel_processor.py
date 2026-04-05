import re
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import HTTPException
import io


def _parse_monto(val) -> float | None:
    """
    Convierte valores monetarios en formato SAP/chileno a float.
    Maneja: '$151.866.29', '77.994,00', '151866', '$0.25', '$ 0.25'
    """
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(val, (int, float)):
        return float(val)
    s = re.sub(r'[$€\s]', '', str(val)).strip()
    if not s or s.lower() in ('nan', 'none', ''):
        return None
    n_puntos = s.count('.')
    n_comas  = s.count(',')
    if n_comas == 1 and n_puntos >= 1:
        # Formato europeo/SAP: 1.234.567,89
        s = s.replace('.', '').replace(',', '.')
    elif n_comas == 0 and n_puntos >= 2:
        # Múltiples puntos = separadores de miles: 151.866.29 → quitar todos menos el último
        partes = s.split('.')
        s = ''.join(partes[:-1]) + '.' + partes[-1]
    elif n_comas == 0 and n_puntos == 1:
        pass  # decimal estándar: 866.29 → ok
    else:
        s = s.replace(',', '')
    try:
        return float(s)
    except (ValueError, TypeError):
        return None

def procesar_excel(file: bytes, db: Session):
    try:
        # Leemos el archivo cargando en memoria todos los sheets
        xls = pd.ExcelFile(io.BytesIO(file))
        sheets = xls.sheet_names
        
        for sheet in sheets:
            df = pd.read_excel(xls, sheet_name=sheet)
            # Normalizar columnas a minúsculas y sin acentos/espacios extra
            df.columns = df.columns.astype(str).str.strip().str.lower().str.replace(' ', '_').str.replace('ó', 'o').str.replace('á', 'a')
            
            sheet_lower = sheet.lower()
            
            # 1. Maestro SKUs
            if "sku" in sheet_lower or "maestro" in sheet_lower:
                if "sku" in df.columns and "nombre" in df.columns:
                    print(f"Procesando Maestro de SKUs desde hoja: {sheet}")
                    procesar_skus(df, db)
                    
            # 2. Factores de Conversión
            elif "factor" in sheet_lower or "conversion" in sheet_lower:
                if "sku" in df.columns:
                    print(f"Procesando Factores de Conversión desde hoja: {sheet}")
                    procesar_factores(df, db)
                    
            # 3. Árbol de Recetas (BOM)
            elif "receta" in sheet_lower or "bom" in sheet_lower or "estructura" in sheet_lower:
                if "sku_padre" in df.columns and "sku_hijo" in df.columns or "sku_ingrediente" in df.columns:
                    print(f"Procesando Recetas desde hoja: {sheet}")
                    procesar_recetas(df, db)
                    
            # 4. Costos de Importación (Precio de Almacén)
            elif "importacion" in sheet_lower or "importaci" in sheet_lower:
                print(f"Procesando Costos de Importación desde hoja: {sheet}")
                procesar_costos_impo(df, db)

            # 5. Compras Consolidadas (Locales)
            elif "compra" in sheet_lower or "costo" in sheet_lower:
                if "sku" in df.columns and ("precio" in df.columns or "costo" in df.columns or "precio_unitario" in df.columns or "costo_unitario" in df.columns):
                    print(f"Procesando Compras Históricas desde hoja: {sheet}")
                    procesar_compras(df, db)
                    
            # 5. Tipos de Cambio
            elif "cambio" in sheet_lower or "dolar" in sheet_lower or "usd" in sheet_lower:
                if "fecha" in df.columns and ("valor" in df.columns or "usd" in df.columns or "tc" in df.columns or "valor_usd" in df.columns):
                    print(f"Procesando Tipos de Cambio desde hoja: {sheet}")
                    procesar_tipos_cambio(df, db)
        
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error procesando Excel en hoja '{sheet}': {str(e)}")

def procesar_skus(df: pd.DataFrame, db: Session):
    # Normalizar columnas para búsqueda insensible a mayúsculas/tildes
    col_map_lower = {str(c).strip().lower(): c for c in df.columns}

    def find_col(*candidates):
        for cand in candidates:
            if cand.strip().lower() in col_map_lower:
                return col_map_lower[cand.strip().lower()]
        return None

    col_sku        = find_col('sku', 'codigo', 'item', 'material',
                              'numero_de_articulo', 'numero de articulo',
                              'número de artículo', 'numero_articulo', 'articulo_superior')
    col_nombre     = find_col('nombre', 'descripcion', 'desc_articulo', 'articulo',
                              'descripcion_del_articulo', 'descripcion del articulo',
                              'descripción del artículo', 'descripcion_articulo_serv.')
    col_unidad     = find_col('unidad_medida', 'unidad', 'udm', 'um',
                              'unidad_de_medida_de_inventario', 'unidad de medida de inventario')
    col_tipo       = find_col('tipo', 'tipo_producto', 'tipo_articulo', 'tipo articulo',
                              'categoria')
    col_costo      = find_col('costo', 'costo_estandar', 'precio', 'costo_unitario',
                              'ultimo_precio_de_compra', 'último precio de compra',
                              'costo_del_articulo')
    col_familia    = find_col('familia', 'family', 'linea', 'grupo_producto', 'nombre_grupo', 'nombre grupo')
    col_subfamilia = find_col('subfamilia', 'subfamily', 'sublinea', 'subgrupo')
    col_densidad   = find_col('densidad', 'density')

    if not col_sku or not col_nombre:
        print("Faltan columnas obligatorias en Maestro")
        return

    for _, row in df.iterrows():
        sku = str(row[col_sku]).strip()
        if pd.isna(sku) or sku == 'nan': continue
            
        nombre = str(row[col_nombre]).strip()
        
        tipo = ""
        if col_tipo and pd.notna(row[col_tipo]):
            tipo = str(row[col_tipo]).strip().capitalize()
        else:
            tipo = "Insumo" # Por defecto
            
        if "producto" in tipo.lower() or "terminado" in tipo.lower() or "pt" in tipo.lower():
            tipo = "Producto Terminado"
        elif "sub" in tipo.lower() or "receta" in tipo.lower() or "sr" in tipo.lower():
            tipo = "Sub-receta"
        else:
            tipo = "Insumo"
            
        unidad_medida = "Unidad"
        if col_unidad and pd.notna(row[col_unidad]):
            unidad_medida = str(row[col_unidad]).strip()
        
        familia    = str(row[col_familia]).strip()    if col_familia    and pd.notna(row[col_familia])    else None
        subfamilia = str(row[col_subfamilia]).strip() if col_subfamilia and pd.notna(row[col_subfamilia]) else None
        densidad   = _parse_monto(row[col_densidad])   if col_densidad   and pd.notna(row[col_densidad])   else None

        # Guardar SKU
        query = text("""
        INSERT INTO maestro_skus (sku, nombre, tipo, unidad_medida, familia, subfamilia, densidad)
        VALUES (:sku, :nombre, :tipo, :unidad_medida, :familia, :subfamilia, :densidad)
        ON CONFLICT (sku) DO UPDATE
        SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, unidad_medida = EXCLUDED.unidad_medida,
            familia = EXCLUDED.familia, subfamilia = EXCLUDED.subfamilia, densidad = EXCLUDED.densidad;
        """)
        db.execute(query, {"sku": sku, "nombre": nombre, "tipo": tipo, "unidad_medida": unidad_medida,
                           "familia": familia, "subfamilia": subfamilia, "densidad": densidad})
        
        # Si la hoja Maestro trajo el Costo insertarlo automágicamente
        if col_costo and pd.notna(row[col_costo]):
            try:
                costo_val = _parse_monto(row[col_costo])
                query_costo = text("""
                INSERT INTO costos_historicos (sku, costo_unitario, moneda, proveedor, fecha_compra) 
                VALUES (:sku, :costo, 'CLP', 'Carga Maestro', CURRENT_DATE)
                """)
                db.execute(query_costo, {"sku": sku, "costo": costo_val})
            except:
                pass

def procesar_factores(df: pd.DataFrame, db: Session):
    col_map = {str(c).strip().lower(): c for c in df.columns}

    def find_col(*candidates):
        for cand in candidates:
            if cand.lower() in col_map:
                return col_map[cand.lower()]
        return None

    col_sku       = find_col('code', 'sku', 'codigo', 'item', 'producto')
    col_unidad    = find_col('unidad medida', 'unidad_medida', 'unidad', 'udm')
    col_litros    = find_col('factor litros', 'factor_litros', 'litros')
    col_kilo_neto = find_col('factor kilo neto', 'factor_kilo_neto', 'kilo_neto', 'kilo neto')
    col_kilo_bruto= find_col('factor kilo bruto', 'factor_kilo_bruto', 'kilo_bruto', 'kilo bruto')

    if not col_sku or not col_unidad:
        return

    for _, row in df.iterrows():
        sku = str(row[col_sku]).strip()
        if pd.isna(sku) or sku == 'nan':
            continue
        unidad = str(row[col_unidad]).strip() if col_unidad and pd.notna(row[col_unidad]) else None
        if not unidad or unidad == 'nan':
            continue

        def to_f(col):
            if col and pd.notna(row[col]):
                try: return float(row[col])
                except: pass
            return None

        litros     = to_f(col_litros)
        kilo_neto  = to_f(col_kilo_neto)
        kilo_bruto = to_f(col_kilo_bruto)

        query = text("""
        INSERT INTO factores_conversion (sku, unidad, litros, kilo_neto, kilo_bruto)
        VALUES (:sku, :unidad, :litros, :kilo_neto, :kilo_bruto)
        ON CONFLICT (sku, unidad) DO UPDATE
        SET litros = EXCLUDED.litros, kilo_neto = EXCLUDED.kilo_neto, kilo_bruto = EXCLUDED.kilo_bruto;
        """)
        try:
            db.execute(query, {"sku": sku, "unidad": unidad, "litros": litros,
                               "kilo_neto": kilo_neto, "kilo_bruto": kilo_bruto})
        except Exception:
            pass  # SKU no existe en maestro_skus → ignorar

def procesar_recetas(df: pd.DataFrame, db: Session):
    col_padre = next((c for c in [
        'sku_padre', 'sku_producto', 'codigo_padre', 'lista_materiales', 'material',
        'articulo_superior',            # SAP Google Sheets
    ] if c in df.columns), None)
    col_hijo = next((c for c in [
        'sku_hijo', 'sku_ingrediente', 'insumo', 'componente', 'codigo_hijo',
        'codigo_de_componente',         # SAP Google Sheets
    ] if c in df.columns), None)
    col_cant = next((c for c in [
        'cantidad_neta', 'cantidad', 'requerido', 'cant', 'cantidad_base',
    ] if c in df.columns), None)

    if not col_padre or not col_hijo or not col_cant:
        return

    col_merma = next((c for c in ['merma', 'porcentaje_merma', '%_merma', 'desperdicio'] if c in df.columns), None)

    for _, row in df.iterrows():
        padre = str(row[col_padre]).strip() if pd.notna(row[col_padre]) else ''
        hijo  = str(row[col_hijo]).strip()  if pd.notna(row[col_hijo])  else ''
        if not padre or not hijo or padre == 'nan' or hijo == 'nan':
            continue

        cantidad = _parse_monto(row[col_cant])
        if cantidad is None or cantidad <= 0:
            continue

        merma = 0.0
        if col_merma and pd.notna(row[col_merma]):
            try:
                merma = float(str(row[col_merma]).replace(',', '.'))
            except (ValueError, TypeError):
                pass

        try:
            db.execute(text("""
                INSERT INTO recetas_bom (sku_padre, sku_hijo, cantidad_neta, porcentaje_merma)
                VALUES (:sku_padre, :sku_hijo, :cantidad_neta, :porcentaje_merma)
                ON CONFLICT (sku_padre, sku_hijo) DO UPDATE
                SET cantidad_neta = EXCLUDED.cantidad_neta,
                    porcentaje_merma = EXCLUDED.porcentaje_merma;
            """), {"sku_padre": padre, "sku_hijo": hijo,
                   "cantidad_neta": cantidad, "porcentaje_merma": merma})
        except Exception:
            db.rollback()
            continue

def procesar_compras(df: pd.DataFrame, db: Session):
    col_sku = next((c for c in [
        'sku', 'codigo', 'item', 'material',
        'numero_de_articulo', 'numero_articulo', 'articulo'
    ] if c in df.columns), None)
    col_costo = next((c for c in [
        'costo_unitario', 'precio_unitario', 'precio_compra',
        'costo', 'precio', 'valor'
    ] if c in df.columns), None)
    if not col_sku or not col_costo: return

    col_moneda = next((c for c in [
        'moneda_del_precio', 'moneda', 'divisa', 'codigo_moneda', 'codigo_de_moneda'
    ] if c in df.columns), None)
    col_prov  = next((c for c in [
        'nombre_de_cliente_proveedor', 'nombre_proveedor', 'proveedor'
    ] if c in df.columns), None)
    col_fecha = next((c for c in [
        'fecha_de_contabilizacion', 'fecha_compra', 'fecha_ingreso',
        'fecha_documento', 'fecha'
    ] if c in df.columns), None)

    for _, row in df.iterrows():
        sku = str(row[col_sku]).strip()
        if not sku or sku == 'nan': continue

        costo = _parse_monto(row[col_costo])
        if costo is None or costo <= 0:
            continue

        moneda = 'CLP'
        if col_moneda and pd.notna(row[col_moneda]):
            val_m = str(row[col_moneda]).strip().upper()
            if 'USD' in val_m or 'DOLAR' in val_m:
                moneda = 'USD'

        proveedor = str(row[col_prov]).strip() if col_prov and pd.notna(row[col_prov]) else ''
        fecha_raw = row[col_fecha] if col_fecha else None
        fecha     = _parsear_fecha(fecha_raw)

        try:
            if fecha:
                db.execute(text("""
                    INSERT INTO costos_historicos (sku, costo_unitario, moneda, proveedor, fecha_compra)
                    VALUES (:sku, :costo, :moneda, :proveedor, :fecha)
                """), {"sku": sku, "costo": costo, "moneda": moneda,
                       "proveedor": proveedor, "fecha": fecha})
            else:
                db.execute(text("""
                    INSERT INTO costos_historicos (sku, costo_unitario, moneda, proveedor, fecha_compra)
                    VALUES (:sku, :costo, :moneda, :proveedor, CURRENT_DATE)
                """), {"sku": sku, "costo": costo, "moneda": moneda, "proveedor": proveedor})
        except Exception:
            db.rollback()
            continue

def _parsear_fecha(valor) -> str | None:
    """
    Convierte un valor de fecha (datetime, string, número Excel) a string 'YYYY-MM-DD'.
    Maneja los formatos más comunes que llegan desde Excel y Google Sheets:
      - Objetos datetime/Timestamp de pandas
      - Strings: '1-2-2023', '2023-02-01', '01/02/2023', '2023/02/01'
      - Números seriales de Excel (float)
    """
    if valor is None or (hasattr(valor, '__class__') and valor.__class__.__name__ == 'NaTType'):
        return None
    try:
        if pd.isna(valor):
            return None
    except (TypeError, ValueError):
        pass

    # Ya es datetime/Timestamp
    if hasattr(valor, 'strftime'):
        return valor.strftime('%Y-%m-%d')

    # Número serial de Excel
    if isinstance(valor, (int, float)):
        try:
            ts = pd.to_datetime('1899-12-30') + pd.to_timedelta(int(valor), unit='D')
            return ts.strftime('%Y-%m-%d')
        except Exception:
            return None

    # String — intentar múltiples formatos
    s = str(valor).strip()
    if not s or s.lower() in ('nan', 'none', ''):
        return None

    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%m-%d-%Y',
                '%d/%m/%Y', '%m/%d/%Y', '%Y/%m/%d',
                '%d.%m.%Y', '%Y.%m.%d'):
        try:
            return pd.to_datetime(s, format=fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue

    # Último intento con inferencia automática (dayfirst=True para formato chileno D-M-Y)
    try:
        return pd.to_datetime(s, dayfirst=True).strftime('%Y-%m-%d')
    except Exception:
        return None


def procesar_tipos_cambio(df: pd.DataFrame, db: Session):
    col_fecha  = next((c for c in ['fecha', 'fecha_de_tipo_de_cambio', 'fecha_cambio'] if c in df.columns), None)
    col_valor  = next((c for c in ['tipo_de_cambio', 'valor_usd', 'valor_eur', 'valor', 'usd', 'tc'] if c in df.columns), None)
    col_moneda = next((c for c in ['codigo_de_moneda', 'moneda', 'divisa', 'codigo_moneda'] if c in df.columns), None)

    if not col_valor or not col_fecha:
        return

    for _, row in df.iterrows():
        fecha = _parsear_fecha(row[col_fecha])
        if not fecha:
            continue

        valor = _parse_monto(row[col_valor])
        if valor is None or valor <= 0:
            continue

        # Determinar moneda: si hay columna explícita usar esa, si no asumir USD
        moneda = 'USD'
        if col_moneda and pd.notna(row[col_moneda]):
            m = str(row[col_moneda]).strip().upper()
            if 'EUR' in m:
                moneda = 'EUR'
            elif 'USD' in m or 'DOL' in m:
                moneda = 'USD'

        try:
            if moneda == 'EUR':
                db.execute(text("""
                    INSERT INTO tipos_cambio (fecha, valor_usd, valor_eur)
                    VALUES (:fecha, 0, :valor)
                    ON CONFLICT (fecha) DO UPDATE
                    SET valor_eur = EXCLUDED.valor_eur;
                """), {"fecha": fecha, "valor": valor})
            else:
                db.execute(text("""
                    INSERT INTO tipos_cambio (fecha, valor_usd)
                    VALUES (:fecha, :valor)
                    ON CONFLICT (fecha) DO UPDATE
                    SET valor_usd = EXCLUDED.valor_usd;
                """), {"fecha": fecha, "valor": valor})
        except Exception:
            db.rollback()
            continue

def procesar_costos_impo(df: pd.DataFrame, db: Session):
    """
    Procesa la hoja 'Costos importacion'.
    Usa 'Precio de almacén' como costo unitario CLP (incluye flete, seguro, aduana).
    Inserta en costos_historicos con proveedor = nombre del acreedor y fuente reconocible.
    """
    col_map = {str(c).strip().lower(): c for c in df.columns}

    def find_col(*candidates):
        for cand in candidates:
            for key, original in col_map.items():
                if cand.lower() in key:
                    return original
        return None

    col_sku      = find_col('numero_de_art', 'n_mero_de_art', 'articulo', 'numero de art')
    col_precio   = find_col('precio_de_almacen', 'almacen', 'almac')
    col_fecha    = find_col('fecha_de_documento', 'fecha_documento')
    col_prov     = find_col('nombre_de_acreedor', 'acreedor', 'proveedor')

    if not col_sku or not col_precio:
        print("Costos importacion: no se encontraron columnas clave (SKU o Precio de almacén)")
        return

    insertados = 0
    for _, row in df.iterrows():
        sku = str(row[col_sku]).strip() if col_sku and pd.notna(row[col_sku]) else None
        if not sku or sku == 'nan':
            continue

        precio = _parse_monto(row[col_precio])
        if precio is None or precio <= 0:
            continue

        fecha = _parsear_fecha(row[col_fecha]) if col_fecha and pd.notna(row[col_fecha]) else None
        prov  = str(row[col_prov]).strip() if col_prov and pd.notna(row[col_prov]) else 'IMPORTACION'

        try:
            if fecha:
                db.execute(text("""
                    INSERT INTO costos_historicos (sku, costo_unitario, moneda, proveedor, fecha_compra)
                    VALUES (:sku, :costo, 'CLP', :proveedor, :fecha)
                """), {"sku": sku, "costo": precio, "proveedor": f"IMPO | {prov}", "fecha": fecha})
            else:
                db.execute(text("""
                    INSERT INTO costos_historicos (sku, costo_unitario, moneda, proveedor, fecha_compra)
                    VALUES (:sku, :costo, 'CLP', :proveedor, CURRENT_DATE)
                """), {"sku": sku, "costo": precio, "proveedor": f"IMPO | {prov}"})
            insertados += 1
        except Exception:
            db.rollback()
            continue

    print(f"Costos importacion: {insertados} registros insertados en costos_historicos")


def procesar_ley_rep(df: pd.DataFrame, db: Session):
    """
    Procesa la hoja 'ley rep' del Google Sheet.
    Mapea ley REP por SKU individual → tabla ley_rep_skus.
    Columnas esperadas (normalizadas): articulo_superior, valor_por_unidad_clp
    """
    col_sku = next((c for c in [
        'articulo_superior', 'sku', 'codigo', 'articulo', 'numero_de_articulo'
    ] if c in df.columns), None)
    col_clp = next((c for c in [
        'valor_por_unidad_clp', 'valor_por_unidad_clp_', 'ley_rep_clp',
        'valor_clp', 'clp', 'valor_por_unidad'
    ] if c in df.columns), None)

    if not col_sku or not col_clp:
        print(f"ley_rep: columnas no encontradas. Disponibles: {list(df.columns)}")
        return

    insertados = 0
    for _, row in df.iterrows():
        sku = str(row[col_sku]).strip() if pd.notna(row[col_sku]) else None
        if not sku or sku == 'nan':
            continue

        clp = _parse_monto(row[col_clp])
        if clp is None or clp < 0:
            continue

        try:
            db.execute(text("""
                INSERT INTO ley_rep_skus (sku, ley_rep_clp, updated_at)
                VALUES (:sku, :clp, NOW())
                ON CONFLICT (sku) DO UPDATE
                SET ley_rep_clp = EXCLUDED.ley_rep_clp,
                    updated_at  = NOW();
            """), {"sku": sku, "clp": clp})
            insertados += 1
        except Exception:
            db.rollback()
            continue

    print(f"ley_rep: {insertados} SKUs actualizados en ley_rep_skus")
