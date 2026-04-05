import pandas as pd
import json

file_path = 'Codifica (Productos Varios prueba).xlsm'
xl = pd.ExcelFile(file_path)

sheets = [
    'tipo de cambio', 'Factor de conversion', 'BASE COMPRAS', 
    'Base IMPO', 'Precio por Formato', 'Lista de productos', 
    'Receta', 'TABLA RECETA', 'PARA CONSULTA'
]

report = {}

for sheet in sheets:
    if sheet in xl.sheet_names:
        df = xl.parse(sheet, nrows=5).dropna(axis=1, how='all')
        report[sheet] = list(df.columns[:10]) # First 10 valid columns 

print(json.dumps(report, indent=2, ensure_ascii=False))
