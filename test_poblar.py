import os
from dotenv import load_dotenv
from sqlalchemy import text
from database import engine

def poblar_datos_prueba():
    print("Iniciando la inserción de datos de prueba (V2 - Multimoneda y Factores)...")
    
    with engine.connect() as conn:
        try:
            # Tipos de Cambio
            print("0. Insertando Tipos de Cambio...")
            conn.execute(text("INSERT INTO tipos_cambio (fecha, valor_usd) VALUES ('2026-03-01', 950.50) ON CONFLICT DO NOTHING"))
            conn.execute(text("INSERT INTO tipos_cambio (fecha, valor_usd) VALUES ('2026-03-10', 980.20) ON CONFLICT DO NOTHING"))

            # Insertar SKUs (Insumos, Sub-recetas, Producto Terminado)
            print("1. Insertando Maestro de SKUs...")
            skus = [
                {"sku": "INS-AGUA", "nombre": "Agua Destilada", "tipo": "Insumo", "unidad_medida": "Lt"},
                {"sku": "INS-RESINA-IMPO", "nombre": "Resina Acrílica (Importada)", "tipo": "Insumo", "unidad_medida": "Kg"},
                {"sku": "INS-PIGMENTO", "nombre": "Pigmento Blanco", "tipo": "Insumo", "unidad_medida": "Kg"},
                {"sku": "SR-BASE-BLANCA", "nombre": "Base de Pintura Blanca", "tipo": "Sub-receta", "unidad_medida": "Lt"},
                {"sku": "PT-PINTURA-1-GALON", "nombre": "Pintura Premium Blanca 1 Galón", "tipo": "Producto Terminado", "unidad_medida": "Unidad"},
                {"sku": "PT-PINTURA-TINETA", "nombre": "Pintura Premium Blanca Tineta", "tipo": "Producto Terminado", "unidad_medida": "Unidad"},
            ]
            for s in skus:
                conn.execute(
                    text("INSERT INTO maestro_skus (sku, nombre, tipo, unidad_medida) VALUES (:sku, :nombre, :tipo, :unidad_medida) ON CONFLICT DO NOTHING"),
                    s
                )

            # Factores de conversión
            print("1b. Insertando Factores de Conversión de Formato...")
            factores = [
                {"sku": "PT-PINTURA-1-GALON", "factor": 3.785, "tipo": "Litros"},
                {"sku": "PT-PINTURA-TINETA", "factor": 18.927, "tipo": "Litros"}
            ]
            for f in factores:
                conn.execute(
                    text("INSERT INTO factores_conversion (sku, factor_multiplicador, tipo_factor) VALUES (:sku, :factor, :tipo) ON CONFLICT DO NOTHING"),
                    f
                )

            # Insertar Costos Históricos
            print("2. Insertando Costos Históricos (Mezcla CLP y USD)...")
            costos = [
                {"sku": "INS-AGUA", "costo": 50.0, "proveedor": "Aguas Claras", "moneda": "CLP", "fecha": "2026-03-10"},
                # Compra importada en dólares:
                {"sku": "INS-RESINA-IMPO", "costo": 1.25, "proveedor": "China Chem", "moneda": "USD", "fecha": "2026-03-01"},
                {"sku": "INS-PIGMENTO", "costo": 3500.0, "proveedor": "Colorantes S.A.", "moneda": "CLP", "fecha": "2026-03-10"},
            ]
            for c in costos:
                conn.execute(
                    text("INSERT INTO costos_historicos (sku, costo_unitario, proveedor, moneda, fecha_compra) VALUES (:sku, :costo, :proveedor, :moneda, :fecha)"),
                    c
                )

            # Insertar Recetas (BOM)
            print("3. Construyendo la Receta (BOM)...")
            recetas = [
                {"padre": "SR-BASE-BLANCA", "hijo": "INS-AGUA", "cantidad": 0.6, "merma": 0.05}, 
                {"padre": "SR-BASE-BLANCA", "hijo": "INS-RESINA-IMPO", "cantidad": 0.4, "merma": 0.02}, 
                # Ahora la receta del PT no dice "requiero 3.8 litros", dice "requiero 1 litro (base) y el factor lo multiplicará"
                {"padre": "PT-PINTURA-1-GALON", "hijo": "SR-BASE-BLANCA", "cantidad": 1.0, "merma": 0.0},
                {"padre": "PT-PINTURA-TINETA", "hijo": "SR-BASE-BLANCA", "cantidad": 1.0, "merma": 0.0},
                # Supongamos que lleva pigmento adicional independiente del formato
                {"padre": "PT-PINTURA-1-GALON", "hijo": "INS-PIGMENTO", "cantidad": 0.05, "merma": 0.10}, 
            ]
            for r in recetas:
                conn.execute(
                    text("""
                    INSERT INTO recetas_bom (sku_padre, sku_hijo, cantidad_neta, porcentaje_merma) 
                    VALUES (:padre, :hijo, :cantidad, :merma) ON CONFLICT DO NOTHING
                    """),
                    r
                )

            print("¡Datos de prueba v2 insertados exitosamente!")
            conn.commit()

        except Exception as e:
            print(f"Ocurrió un error al poblar datos: {e}")
            conn.rollback()

if __name__ == "__main__":
    load_dotenv()
    poblar_datos_prueba()
