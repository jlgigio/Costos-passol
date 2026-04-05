import pandas as pd
import json

file_path = 'Base de datos.xlsx'
xl = pd.ExcelFile(file_path)
print("Hojas disponibles:", xl.sheet_names)

for target in ["compras", "costos importacion", "receta"]:
    sheet = next((s for s in xl.sheet_names if target.lower() in s.lower()), None)
    if sheet:
        df = xl.parse(sheet, nrows=5)
        print(f"\nColumnas en {sheet}:")
        print(json.dumps(df.columns.tolist(), indent=2))
        if target == "compras":
            print(df.head(2).to_dict('records'))
    else:
        print(f"\nNo se encontró hoja para {target}")
