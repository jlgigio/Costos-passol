import psycopg2

with psycopg2.connect('postgresql://postgres:postgres@localhost:5432/postgres') as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT sku, fecha_compra, costo_unitario, moneda FROM costos_historicos LIMIT 10")
        rows = cur.fetchall()
        print([dict(zip(["sku", "fecha", "costo", "moneda"], [r[0], str(r[1]), float(r[2]), r[3]])) for r in rows])
        
        # Check how many costs we have
        cur.execute("SELECT COUNT(*) FROM costos_historicos")
        print("Total costos en historico:", cur.fetchone()[0])

        # Try mapping with vista_ultimo_costo for DILUYENTE
        cur.execute("SELECT sku, costo_unitario_clp, costo_unitario_usd FROM vista_ultimo_costo WHERE sku ILIKE '%DIL%' LIMIT 5")
        print("Vista ultimo costo dil:", [dict(zip(["sku", "clp", "usd"], [r[0], float(r[1]), float(r[2])])) for r in cur.fetchall()])
