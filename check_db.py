import psycopg2
import os
import pandas as pd
from dotenv import load_dotenv
import warnings

warnings.filterwarnings('ignore')
load_dotenv()

try:
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    sku = '101214027'

    print("--- MAESTRO SKUs MATCHING ---")
    df_sku = pd.read_sql_query(f"SELECT * FROM maestro_skus WHERE sku LIKE '%%101214027%%'", conn)
    print(df_sku)

    print("\n--- TEST: TODAS LAS RECETAS (LIMIT 5) ---")
    df_bom = pd.read_sql_query("SELECT * FROM recetas_bom LIMIT 5", conn)
    print(df_bom)

    print("\n--- TOTAL RECORDS ---")
    print('Skus:', pd.read_sql_query('SELECT count(*) FROM maestro_skus', conn).iloc[0,0])
    print('Recetas:', pd.read_sql_query('SELECT count(*) FROM recetas_bom', conn).iloc[0,0])
    print('Costos:', pd.read_sql_query('SELECT count(*) FROM costos_historicos', conn).iloc[0,0])
    print('Factores:', pd.read_sql_query('SELECT count(*) FROM factores_conversion', conn).iloc[0,0])
    print('Tipos Cambio:', pd.read_sql_query('SELECT count(*) FROM tipos_cambio', conn).iloc[0,0])

    conn.close()
except Exception as e:
    print("Error:", e)
