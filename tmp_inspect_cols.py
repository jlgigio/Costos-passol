import pandas as pd
import json

file_path = 'Base de datos.xlsx'
xl = pd.ExcelFile(file_path)
maestro_sheet = next((s for s in xl.sheet_names if 'maestro' in s.lower()), None)
if maestro_sheet:
    df = xl.parse(maestro_sheet, nrows=5)
    cols = df.columns.tolist()
    print("Columnas en Maestro:")
    print(json.dumps(cols, indent=2))
else:
    print("No se encontró hoja 'maestro'. Hojas disponibles:", xl.sheet_names)
