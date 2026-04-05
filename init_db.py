import os
from sqlalchemy import text
from dotenv import load_dotenv
from database import engine

def init_db():
    print("Conectando a postgresql y creando el esquema...")
    
    # 1. Leemos el archivo SQL que generamos antes
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, 'r', encoding='utf-8') as f:
        sql_commands = f.read()

    # 2. Nos conectamos y ejecutamos todo
    try:
        with engine.connect() as connection:
            # En SQLAlchemy 2.0+ las sentencias multiples deben pasarse limpias
            # O utilizar ejecución de texto crudo en bloque
            # Ejecutamos comando por comando o todo el bloque si el driver lo soporta
            try:
                connection.execute(text(sql_commands))
                connection.commit()
                print("¡Esquema creado correctamente en Supabase!")
            except Exception as e:
                connection.rollback()
                import traceback
                traceback.print_exc()
                print(f"Ocurrió un error al intentar crear las tablas (SQL): {e}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Ocurrió un error al intentar crear las tablas: {e}")

if __name__ == "__main__":
    load_dotenv()
    init_db()
