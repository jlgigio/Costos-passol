import pandas as pd
import json

file_path = "Codifica (Productos Varios prueba).xlsm"
try:
    xl = pd.ExcelFile(file_path)
    report = {}
    for sheet in ["ley rep", "PARA CONSULTA", "Lista de productos"]:
        if sheet in xl.sheet_names:
            df = xl.parse(sheet, nrows=5).dropna(axis=1, how='all')
            # Convert timestamp columns to string
            for col in df.select_dtypes(include=['datetime64']).columns:
                df[col] = df[col].astype(str)
            report[sheet] = df.to_dict('list')
    print(json.dumps(report, indent=2, ensure_ascii=False))
except Exception as e:
    print(str(e))
