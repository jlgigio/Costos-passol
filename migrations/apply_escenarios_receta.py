"""Aplica la tabla escenarios_receta a la BD."""
import psycopg2, os, pathlib

DB = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "dbname": os.getenv("DB_NAME", "passol_costeo"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASS", ""),
}

sql = (pathlib.Path(__file__).parent / "add_escenarios_receta.sql").read_text()

conn = psycopg2.connect(**DB)
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute(sql)
print("✅ Tabla escenarios_receta creada (o ya existía).")
conn.close()
