"""
crear_admin.py
Ejecutar UNA VEZ para crear el primer usuario administrador.

Uso:
    python crear_admin.py

Puedes modificar EMAIL, NOMBRE y PASSWORD antes de ejecutar.
"""
import os, re, sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

# ── CONFIGURA AQUÍ TUS DATOS DE ADMINISTRADOR ─────────────────────────────────
EMAIL    = "admin@passol.cl"
NOMBRE   = "Administrador"
PASSWORD = "Passol2025!"          # ← CAMBIA ESTA CONTRASEÑA
# ──────────────────────────────────────────────────────────────────────────────

sys.path.insert(0, os.path.dirname(__file__))
from services.auth import hash_password

url = os.getenv("DATABASE_URL", "")
m   = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', url)
if not m:
    print("ERROR: DATABASE_URL no configurada en .env")
    sys.exit(1)

user, pwd, host, port, db = m.groups()
conn = psycopg2.connect(host=host, port=int(port), dbname=db, user=user, password=pwd)
cur  = conn.cursor()

# Verificar si ya existe
cur.execute("SELECT id, email FROM usuarios WHERE email = %s", (EMAIL.lower(),))
existe = cur.fetchone()

if existe:
    print(f"\n⚠  Ya existe un usuario con email '{EMAIL}' (id={existe[0]}).")
    resp = input("   ¿Deseas actualizar su contraseña? (s/N): ").strip().lower()
    if resp == 's':
        cur.execute(
            "UPDATE usuarios SET password_hash = %s, es_admin = TRUE, activo = TRUE WHERE email = %s",
            (hash_password(PASSWORD), EMAIL.lower())
        )
        conn.commit()
        print(f"✓  Contraseña actualizada para {EMAIL}")
    else:
        print("   Sin cambios.")
else:
    permisos = {m: True for m in [
        "consulta","simulador","manuales","clientes",
        "parametros","import","productos","mp",
        "dashboard","alertas","historial"
    ]}
    import json
    cur.execute(
        """INSERT INTO usuarios (email, nombre, password_hash, es_admin, permisos)
           VALUES (%s, %s, %s, TRUE, %s::jsonb)""",
        (EMAIL.lower(), NOMBRE, hash_password(PASSWORD), json.dumps(permisos))
    )
    conn.commit()
    print(f"\n✓  Administrador creado exitosamente:")
    print(f"   Email:      {EMAIL}")
    print(f"   Contraseña: {PASSWORD}")
    print(f"\n   ¡Cambia la contraseña después de tu primer login!\n")

cur.close()
conn.close()
