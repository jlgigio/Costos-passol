# Simulador de Rentabilidad por Cadena — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Agregar pestaña "Simulador Rent." en módulo Clientes que permite simular condiciones comerciales por cadena, recalcular rentabilidad vía backend, y guardar resultados sobreescribiendo condiciones o como escenario separado.

**Architecture:** Nuevo router FastAPI para simulación y CRUD de escenarios. Nueva tabla PostgreSQL `escenarios_rentabilidad`. Frontend en App.tsx: nueva pestaña con tabla resumen + panel edición por cadena + sección escenarios guardados. El cálculo usa el mismo motor del backend (no se replica en frontend).

**Tech Stack:** FastAPI, SQLAlchemy, psycopg2, PostgreSQL, React 18, TypeScript, App.tsx (single-file UI)

---

## Task 1: Migración de base de datos — tabla `escenarios_rentabilidad`

**Files:**
- Create: `migracion_escenarios.py`

**Step 1: Crear el script de migración**

```python
"""
Migración: crear tabla escenarios_rentabilidad
"""
import psycopg2
import sys
sys.stdout.reconfigure(encoding='utf-8')

conn = psycopg2.connect(dbname='postgres', user='postgres', password='postgres', host='localhost', port=5432)
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS escenarios_rentabilidad (
        id                    SERIAL PRIMARY KEY,
        nombre                VARCHAR(100) NOT NULL,
        sku                   VARCHAR(50),
        nombre_sku            VARCHAR(200),
        cliente_id            INTEGER,
        cliente               VARCHAR(100),
        factor                NUMERIC(10,4) DEFAULT 1,
        descuento_max         NUMERIC(10,4) DEFAULT 0,
        comision_promedio     NUMERIC(10,4) DEFAULT 0,
        rapell                NUMERIC(10,4) DEFAULT 0,
        fee                   NUMERIC(10,4) DEFAULT 0,
        marketing             NUMERIC(10,4) DEFAULT 0,
        x_docking             NUMERIC(10,4) DEFAULT 0,
        rebate                NUMERIC(10,4) DEFAULT 0,
        rebate_centralizacion NUMERIC(10,4) DEFAULT 0,
        flete_kilo            NUMERIC(10,4) DEFAULT 0,
        pallet_kilo           NUMERIC(10,4) DEFAULT 0,
        precio_lista          NUMERIC(12,2) DEFAULT 0,
        precio_final          NUMERIC(12,2) DEFAULT 0,
        cm2_pct               NUMERIC(8,4)  DEFAULT 0,
        utilidad              NUMERIC(12,2) DEFAULT 0,
        created_at            TIMESTAMP DEFAULT NOW()
    );
""")
print("✓ Tabla escenarios_rentabilidad creada")

conn.commit()
conn.close()
print("✓ Migración completada")
```

**Step 2: Ejecutar el script**
```bash
cd c:\Users\gigio\Desktop\PASSOL_COSTEO_DEV
python migracion_escenarios.py
```
Expected: `✓ Tabla escenarios_rentabilidad creada` + `✓ Migración completada`

---

## Task 2: Backend — endpoint `POST /api/rentabilidad/simular`

**Files:**
- Create: `routers/escenarios.py`

**Step 1: Crear el router con el endpoint de simulación**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from typing import Dict, List

router_escenarios = APIRouter(prefix="/api/escenarios", tags=["Escenarios"])
router_simulacion = APIRouter(prefix="/api/rentabilidad", tags=["Simulación Rentabilidad"])

@router_simulacion.post("/simular", response_model=Dict)
def simular_rentabilidad(payload: Dict, db: Session = Depends(get_db)):
    """
    Calcula rentabilidad para UNA cadena con parámetros personalizados.
    Reutiliza la misma lógica que calcular_rentabilidad_clientes pero para un solo cliente.
    """
    costo_base = float(payload.get("costo_base_clp", 0))
    peso_kg    = float(payload.get("peso_kg", 1))
    sku        = payload.get("sku", "")

    # Obtener ley_rep y disposicion desde BD (parámetros globales)
    param = dict(db.execute(text("SELECT * FROM parametros_comerciales WHERE id = 1")).fetchone()._mapping)

    _ley_row = db.execute(text("SELECT ley_rep_clp FROM ley_rep_skus WHERE sku = :sku LIMIT 1"), {"sku": sku}).fetchone()
    ley_rep    = float(_ley_row[0]) if _ley_row and _ley_row[0] else peso_kg * float(param["ley_rep_por_kilo"])
    disposicion = peso_kg * float(param["disposicion_por_kilo"])
    gtos_indirectos = costo_base * float(param["gastos_indirectos_porcentaje"])

    # Parámetros del cliente (ingresados por el usuario)
    flete_kilo   = float(payload.get("flete_kilo", 0))
    pallet_kilo  = float(payload.get("pallet_kilo", 0))
    factor       = float(payload.get("factor", 1))
    descuento    = float(payload.get("descuento_max", 0))
    comision_pct = float(payload.get("comision_promedio", 0))
    plan_pct     = (float(payload.get("rapell", 0)) +
                    float(payload.get("fee", 0)) +
                    float(payload.get("marketing", 0)) +
                    float(payload.get("x_docking", 0)) +
                    float(payload.get("rebate", 0)) +
                    float(payload.get("rebate_centralizacion", 0)))

    flete  = peso_kg * flete_kilo
    pallet = peso_kg * pallet_kilo

    costo_parcial = costo_base + flete + pallet + ley_rep + disposicion + gtos_indirectos
    p_lista = costo_parcial * factor
    p_final = p_lista * (1 - descuento)

    comision_monto        = p_final * comision_pct
    plan_comercial_monto  = p_final * plan_pct
    costo_total           = costo_parcial + comision_monto + plan_comercial_monto
    utilidad              = p_final - costo_total

    mg_final = (utilidad / p_final * 100) if p_final > 0 else 0
    mg_lista = ((p_lista - costo_total) / p_lista * 100) if p_lista > 0 else 0

    nnr  = p_final - plan_comercial_monto - comision_monto
    cm1  = nnr - costo_base - ley_rep - disposicion - flete - pallet
    cm2  = cm1 - gtos_indirectos
    cm1_pct = (cm1 / nnr * 100) if nnr > 0 else 0
    cm2_pct = (cm2 / nnr * 100) if nnr > 0 else 0

    precio_piso = costo_total  # precio mínimo donde utilidad = 0

    return {
        "precio_lista":          round(p_lista, 2),
        "precio_final":          round(p_final, 2),
        "costo_parcial":         round(costo_parcial, 2),
        "comision_monto":        round(comision_monto, 2),
        "plan_comercial_monto":  round(plan_comercial_monto, 2),
        "costo_total":           round(costo_total, 2),
        "cm1":                   round(cm1, 2),
        "cm1_pct":               round(cm1_pct, 2),
        "cm2":                   round(cm2, 2),
        "cm2_pct":               round(cm2_pct, 2),
        "mg_lista_porc":         round(mg_lista, 2),
        "mg_final_porc":         round(mg_final, 2),
        "utilidad":              round(utilidad, 2),
        "precio_piso":           round(precio_piso, 2),
        "ley_rep":               round(ley_rep, 2),
        "disposicion":           round(disposicion, 2),
        "gtos_indirectos":       round(gtos_indirectos, 2),
        "flete":                 round(flete, 2),
        "pallet":                round(pallet, 2),
    }
```

**Step 2: Verificar sintaxis**
```bash
cd c:\Users\gigio\Desktop\PASSOL_COSTEO_DEV
python -c "from routers.escenarios import router_simulacion; print('OK')"
```
Expected: `OK`

---

## Task 3: Backend — CRUD endpoints `/api/escenarios`

**Files:**
- Modify: `routers/escenarios.py` (agregar al archivo ya creado en Task 2)

**Step 1: Agregar endpoints GET, POST, DELETE de escenarios al mismo archivo**

```python
# ── Escenarios guardados ────────────────────────────────────────

@router_escenarios.get("/", response_model=List[Dict])
def listar_escenarios(sku: str = "", db: Session = Depends(get_db)):
    """Lista escenarios guardados, opcionalmente filtrados por SKU."""
    if sku:
        rows = db.execute(text(
            "SELECT * FROM escenarios_rentabilidad WHERE sku = :sku ORDER BY created_at DESC"
        ), {"sku": sku}).fetchall()
    else:
        rows = db.execute(text(
            "SELECT * FROM escenarios_rentabilidad ORDER BY created_at DESC LIMIT 50"
        )).fetchall()
    return [dict(r._mapping) for r in rows]


@router_escenarios.post("/", response_model=Dict)
def crear_escenario(payload: Dict, db: Session = Depends(get_db)):
    """Guarda un escenario de rentabilidad simulado."""
    result = db.execute(text("""
        INSERT INTO escenarios_rentabilidad
            (nombre, sku, nombre_sku, cliente_id, cliente,
             factor, descuento_max, comision_promedio,
             rapell, fee, marketing, x_docking, rebate, rebate_centralizacion,
             flete_kilo, pallet_kilo,
             precio_lista, precio_final, cm2_pct, utilidad)
        VALUES
            (:nombre, :sku, :nombre_sku, :cliente_id, :cliente,
             :factor, :descuento_max, :comision_promedio,
             :rapell, :fee, :marketing, :x_docking, :rebate, :rebate_centralizacion,
             :flete_kilo, :pallet_kilo,
             :precio_lista, :precio_final, :cm2_pct, :utilidad)
        RETURNING id, nombre, created_at
    """), {
        "nombre":               payload.get("nombre", "Sin nombre"),
        "sku":                  payload.get("sku", ""),
        "nombre_sku":           payload.get("nombre_sku", ""),
        "cliente_id":           payload.get("cliente_id"),
        "cliente":              payload.get("cliente", ""),
        "factor":               float(payload.get("factor", 1)),
        "descuento_max":        float(payload.get("descuento_max", 0)),
        "comision_promedio":    float(payload.get("comision_promedio", 0)),
        "rapell":               float(payload.get("rapell", 0)),
        "fee":                  float(payload.get("fee", 0)),
        "marketing":            float(payload.get("marketing", 0)),
        "x_docking":            float(payload.get("x_docking", 0)),
        "rebate":               float(payload.get("rebate", 0)),
        "rebate_centralizacion":float(payload.get("rebate_centralizacion", 0)),
        "flete_kilo":           float(payload.get("flete_kilo", 0)),
        "pallet_kilo":          float(payload.get("pallet_kilo", 0)),
        "precio_lista":         float(payload.get("precio_lista", 0)),
        "precio_final":         float(payload.get("precio_final", 0)),
        "cm2_pct":              float(payload.get("cm2_pct", 0)),
        "utilidad":             float(payload.get("utilidad", 0)),
    })
    db.commit()
    row = result.fetchone()
    return {"status": "ok", "id": row[0], "nombre": row[1]}


@router_escenarios.delete("/{id}")
def eliminar_escenario(id: int, db: Session = Depends(get_db)):
    result = db.execute(text("DELETE FROM escenarios_rentabilidad WHERE id = :id"), {"id": id})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"Escenario {id} no encontrado.")
    return {"status": "ok", "id": id}
```

**Step 2: Verificar sintaxis completa del archivo**
```bash
python -c "from routers.escenarios import router_simulacion, router_escenarios; print('OK')"
```
Expected: `OK`

---

## Task 4: Backend — registrar routers en `main.py`

**Files:**
- Modify: `main.py`

**Step 1: Importar y registrar los nuevos routers**

Encontrar:
```python
from routers.parametros import router_params, router_clientes, router_ley_rep
```
Reemplazar con:
```python
from routers.parametros import router_params, router_clientes, router_ley_rep
from routers.escenarios import router_simulacion, router_escenarios
```

Encontrar:
```python
app.include_router(router_ley_rep)
```
Agregar debajo:
```python
app.include_router(router_simulacion)
app.include_router(router_escenarios)
```

**Step 2: Reiniciar backend y verificar endpoints**
```bash
uvicorn main:app --reload --port 8000
```
Abrir en browser: `http://localhost:8000/docs`
Verificar que aparecen:
- `POST /api/rentabilidad/simular`
- `GET /api/escenarios/`
- `POST /api/escenarios/`
- `DELETE /api/escenarios/{id}`

---

## Task 5: Frontend — estados + pestaña "Simulador Rent."

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Extender el tipo de `cadenasTab`**

Encontrar:
```tsx
const [cadenasTab, setCadenasTab] = useState<'condiciones' | 'flete' | 'pallet' | 'rentabilidad'>('condiciones')
```
Reemplazar con:
```tsx
const [cadenasTab, setCadenasTab] = useState<'condiciones' | 'flete' | 'pallet' | 'rentabilidad' | 'sim-rent'>('condiciones')
```

**Step 2: Agregar estados del simulador de rentabilidad**

Justo debajo de los estados de `rentSearch`, `rentSug`, `rentData`, `rentLoading` agregar:
```tsx
// Simulador de Rentabilidad
const [srSearch, setSrSearch] = useState('')
const [srSug, setSrSug] = useState<any[]>([])
const [srData, setSrData] = useState<any>(null)        // explosion base del SKU
const [srLoading, setSrLoading] = useState(false)
const [srSelected, setSrSelected] = useState<any>(null) // cadena seleccionada (row de rentabilidad_clientes)
const [srInputs, setSrInputs] = useState<any>({})       // valores editables del panel
const [srResult, setSrResult] = useState<any>(null)     // resultado calculado
const [srCalcLoading, setSrCalcLoading] = useState(false)
const [srScenName, setSrScenName] = useState('')
const [srScenarios, setSrScenarios] = useState<any[]>([])
const [srConfirm, setSrConfirm] = useState(false)       // confirmación opción 1
const [srSaveMsg, setSrSaveMsg] = useState('')
```

**Step 3: Agregar la pestaña en el selector de tabs de Clientes**

Encontrar:
```tsx
{(['condiciones', 'flete', 'pallet', 'rentabilidad'] as const).map(tab => {
  const labels: Record<string, string> = { condiciones: 'Condiciones comerciales', flete: 'Costo Flete × Kilo', pallet: 'Costo Pallet × Kilo', rentabilidad: 'Rentabilidad por Cadena' }
```
Reemplazar con:
```tsx
{(['condiciones', 'flete', 'pallet', 'rentabilidad', 'sim-rent'] as const).map(tab => {
  const labels: Record<string, string> = { condiciones: 'Condiciones comerciales', flete: 'Costo Flete × Kilo', pallet: 'Costo Pallet × Kilo', rentabilidad: 'Rentabilidad por Cadena', 'sim-rent': '⚡ Simulador Rent.' }
```

**Step 4: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errores.

---

## Task 6: Frontend — funciones de carga + tabla resumen

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Agregar funciones auxiliares del simulador de rentabilidad**

Buscar el bloque de funciones `loadRentabilidad` (cerca de línea 394). Agregar DEBAJO:

```tsx
// ── Simulador Rentabilidad ──────────────────────────────────
const searchSrSku = async (q: string) => {
  setSrSearch(q); setSrSug([])
  if (q.length < 2) return
  const r = await fetch(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto%20Terminado`)
  if (r.ok) setSrSug(await r.json())
}

const loadSrData = async (sku: string, nombre: string) => {
  setSrSearch(nombre); setSrSug([]); setSrLoading(true)
  setSrData(null); setSrSelected(null); setSrResult(null); setSrScenarios([])
  const r = await fetch(`${API}/api/costos/${sku}/explosion`)
  if (r.ok) {
    const d = await r.json()
    setSrData(d)
    // Cargar escenarios del SKU
    const e = await fetch(`${API}/api/escenarios/?sku=${sku}`)
    if (e.ok) setSrScenarios(await e.json())
  }
  setSrLoading(false)
}

const selectSrCliente = (rc: any) => {
  setSrSelected(rc)
  setSrResult(null)
  setSrConfirm(false)
  setSrSaveMsg('')
  // Pre-llenar inputs con valores actuales de la cadena
  // rc viene de rentabilidad_clientes que tiene los campos del cliente
  // Necesitamos el cliente original de clientes_condiciones
  const clienteOrig = (srData?.clientes_orig || []).find((c: any) => c.cliente === rc.cliente) || {}
  setSrInputs({
    factor:               clienteOrig.factor ?? 1,
    descuento_max:        clienteOrig.descuento_max ?? 0,
    comision_promedio:    clienteOrig.comision_promedio ?? 0,
    rapell:               clienteOrig.rapell ?? 0,
    fee:                  clienteOrig.fee ?? 0,
    marketing:            clienteOrig.marketing ?? 0,
    x_docking:            clienteOrig.x_docking ?? 0,
    rebate:               clienteOrig.rebate ?? 0,
    rebate_centralizacion:clienteOrig.rebate_centralizacion ?? 0,
    flete_kilo:           rc.flete_clp > 0 && srData?.peso_kilos > 0 ? +(rc.flete_clp / srData.peso_kilos).toFixed(4) : 0,
    pallet_kilo:          rc.pallet_clp > 0 && srData?.peso_kilos > 0 ? +(rc.pallet_clp / srData.peso_kilos).toFixed(4) : 0,
    _clienteId:           clienteOrig.id,
    _clienteNombre:       rc.cliente,
  })
}

const calcularSr = async () => {
  if (!srData || !srSelected) return
  setSrCalcLoading(true)
  const r = await fetch(`${API}/api/rentabilidad/simular`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku:          srData.sku,
      costo_base_clp: srData.costo_total_con_merma,
      peso_kg:      srData.peso_kilos || 1,
      ...srInputs,
    })
  })
  if (r.ok) setSrResult(await r.json())
  setSrCalcLoading(false)
}

const restablecerSr = () => {
  if (srSelected) selectSrCliente(srSelected)
  setSrResult(null)
}

const guardarCondicionesSr = async () => {
  if (!srInputs._clienteId) return
  const body = {
    cliente:              srInputs._clienteNombre,
    factor:               srInputs.factor,
    descuento_max:        srInputs.descuento_max,
    comision_promedio:    srInputs.comision_promedio,
    rapell:               srInputs.rapell,
    fee:                  srInputs.fee,
    marketing:            srInputs.marketing,
    x_docking:            srInputs.x_docking,
    rebate:               srInputs.rebate,
    rebate_centralizacion:srInputs.rebate_centralizacion,
    flete_agua_kilo:      srInputs.flete_kilo,
    flete_otros_kilo:     srInputs.flete_kilo,
    pallet_agua_kilo:     srInputs.pallet_kilo,
    pallet_otros_kilo:    srInputs.pallet_kilo,
  }
  const r = await fetch(`${API}/api/clientes/${srInputs._clienteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (r.ok) {
    setSrSaveMsg('✓ Condiciones actualizadas correctamente')
    setSrConfirm(false)
    await loadClientes()
  } else {
    setSrSaveMsg('⚠ Error al guardar condiciones')
  }
}

const guardarEscenarioSr = async () => {
  if (!srScenName.trim() || !srResult) return
  const r = await fetch(`${API}/api/escenarios/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre:     srScenName.trim(),
      sku:        srData.sku,
      nombre_sku: srSearch,
      cliente_id: srInputs._clienteId,
      cliente:    srInputs._clienteNombre,
      ...srInputs,
      precio_lista: srResult.precio_lista,
      precio_final: srResult.precio_final,
      cm2_pct:      srResult.cm2_pct,
      utilidad:     srResult.utilidad,
    })
  })
  if (r.ok) {
    setSrSaveMsg('✓ Escenario guardado')
    setSrScenName('')
    const e = await fetch(`${API}/api/escenarios/?sku=${srData.sku}`)
    if (e.ok) setSrScenarios(await e.json())
  }
}

const eliminarEscenarioSr = async (id: number) => {
  const r = await fetch(`${API}/api/escenarios/${id}`, { method: 'DELETE' })
  if (r.ok) setSrScenarios(srScenarios.filter(s => s.id !== id))
}
```

**Step 2: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 7: Frontend — JSX pestaña "Simulador Rent." (búsqueda + tabla resumen + panel)

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Agregar el JSX de la nueva pestaña**

Buscar el cierre del bloque `{cadenasTab === 'rentabilidad' && (...)}`. Justo DESPUÉS agregar:

```tsx
{/* TAB: Simulador Rentabilidad */}
{cadenasTab === 'sim-rent' && (
  <div style={{ padding: '1.25rem' }}>

    {/* Búsqueda SKU */}
    <div style={{ maxWidth: 480, marginBottom: '1.25rem' }}>
      <div className="sb-input-wrap">
        <input
          className="sb-input"
          placeholder="Buscar producto terminado…"
          value={srSearch}
          onChange={e => searchSrSku(e.target.value)}
        />
      </div>
      {srSug.length > 0 && (
        <div className="autocomplete-dropdown">
          {srSug.map((s: any) => (
            <div key={s.sku} className="autocomplete-item"
              onClick={() => loadSrData(s.sku, s.nombre)}>
              <strong>{s.sku}</strong> — {s.nombre}
            </div>
          ))}
        </div>
      )}
    </div>

    {srLoading && <div className="empty-state">Cargando…</div>}

    {srData && !srLoading && (
      <>
        {/* Info del SKU */}
        <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: '#555' }}>
          <strong style={{ color: 'var(--secondary)' }}>{srData.sku}</strong>
          {' — '}Costo base: <strong>${fmt(srData.costo_total_con_merma)}</strong>
          {srData.peso_kilos > 0 && <> · {fmt(srData.peso_kilos, 3)} kg</>}
        </div>

        {/* Tabla resumen por cadena */}
        <div className="tbl-wrap" style={{ marginBottom: '1.25rem' }}>
          <table className="tbl" style={{ fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th>Cadena</th>
                <th className="num">P. Final actual</th>
                <th className="num">CM2 % actual</th>
                <th className="num">Utilidad actual</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(srData.rentabilidad_clientes || []).map((rc: any) => {
                const isSelected = srSelected?.cliente === rc.cliente
                const cm2 = rc.mg_final_porc
                const good = cm2 >= 15
                return (
                  <tr key={rc.cliente}
                    style={{ background: isSelected ? 'var(--primary-light)' : undefined, cursor: 'pointer' }}
                    onClick={() => selectSrCliente(rc)}>
                    <td style={{ fontWeight: isSelected ? 700 : 400 }}>{rc.cliente}</td>
                    <td className="num">${fmt(rc.precio_final_envase)}</td>
                    <td className="num" style={{ color: good ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                      {fmt(cm2, 1)}%
                    </td>
                    <td className="num">${fmt(rc.utilidad_final)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); selectSrCliente(rc) }}>
                        Simular →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Panel de edición */}
        {srSelected && (
          <div className="card" style={{ marginBottom: '1.25rem', maxWidth: 680 }}>
            <div className="card-title" style={{ marginBottom: '0.75rem' }}>
              Simulador — {srSelected.cliente}
            </div>

            {/* Grid actual vs simulado */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1rem' }}>

              {/* Columna PARÁMETROS */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '0.5rem' }}>
                  Parámetros editables
                </div>
                {[
                  ['Factor',            'factor',               '×'],
                  ['Descuento %',       'descuento_max',        '%'],
                  ['Comisión %',        'comision_promedio',    '%'],
                  ['Rapell %',          'rapell',               '%'],
                  ['Fee %',             'fee',                  '%'],
                  ['Marketing %',       'marketing',            '%'],
                  ['X-Docking %',       'x_docking',            '%'],
                  ['Rebate %',          'rebate',               '%'],
                  ['Centralización %',  'rebate_centralizacion','%'],
                  ['Flete (CLP/kg)',    'flete_kilo',           '$'],
                  ['Pallet (CLP/kg)',   'pallet_kilo',          '$'],
                ].map(([label, key, unit]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.82rem' }}>
                    <span style={{ color: '#555' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number"
                        className="no-spin"
                        step={key === 'factor' ? 0.01 : key.includes('kilo') ? 1 : 0.001}
                        value={(srInputs as any)[key] ?? 0}
                        onChange={e => setSrInputs({ ...srInputs, [key]: parseFloat(e.target.value) || 0 })}
                        style={{
                          width: 80, border: '1px solid var(--border)', borderRadius: 4,
                          padding: '0.2rem 0.4rem', fontSize: '0.82rem', textAlign: 'right'
                        }}
                      />
                      <span style={{ fontSize: '0.75rem', color: '#999', width: 16 }}>{unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Columna RESULTADOS */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: '0.5rem' }}>
                  Resultados
                </div>
                {[
                  ['P. Lista actual',   `$${fmt(srSelected.precio_lista_envase)}`,  srResult ? `$${fmt(srResult.precio_lista)}` : '—'],
                  ['P. Final actual',   `$${fmt(srSelected.precio_final_envase)}`,  srResult ? `$${fmt(srResult.precio_final)}` : '—'],
                  ['CM2 %',             `${fmt(srSelected.mg_final_porc, 1)}%`,      srResult ? `${fmt(srResult.cm2_pct, 1)}%` : '—'],
                  ['Utilidad',          `$${fmt(srSelected.utilidad_final)}`,        srResult ? `$${fmt(srResult.utilidad)}` : '—'],
                ].map(([label, actual, simul]) => {
                  const isImproved = srResult && label !== 'P. Lista actual' && label !== 'P. Final actual' &&
                    parseFloat(String(simul).replace(/[^0-9.-]/g, '')) > parseFloat(String(actual).replace(/[^0-9.-]/g, ''))
                  return (
                    <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.82rem', borderBottom: '1px solid #f0f0f0', paddingBottom: '0.35rem' }}>
                      <span style={{ color: '#555' }}>{label}</span>
                      <div style={{ display: 'flex', gap: 12, textAlign: 'right' }}>
                        <span style={{ color: '#999', minWidth: 80 }}>{actual}</span>
                        <span style={{
                          minWidth: 80, fontWeight: srResult ? 700 : 400,
                          color: srResult ? (isImproved ? 'var(--success)' : 'var(--danger)') : '#bbb'
                        }}>{simul}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Acciones del panel */}
            <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={restablecerSr}>↺ Restablecer</button>
              <button className="btn btn-primary btn-sm" onClick={calcularSr} disabled={srCalcLoading}>
                {srCalcLoading ? 'Calculando…' : '⚡ Calcular'}
              </button>
            </div>

            {/* Sección Guardar */}
            {srResult && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Guardar resultado
                </div>

                {/* Opción 1 */}
                {!srConfirm ? (
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: '0.5rem' }}
                    onClick={() => { setSrConfirm(true); setSrSaveMsg('') }}>
                    [1] Sobreescribir condiciones actuales de {srSelected.cliente}
                  </button>
                ) : (
                  <div style={{ background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.82rem' }}>
                    ⚠ ¿Confirmar? Esto reemplazará las condiciones actuales de <strong>{srSelected.cliente}</strong> en la BD.
                    <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={guardarCondicionesSr}>Confirmar</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSrConfirm(false)}>Cancelar</button>
                    </div>
                  </div>
                )}

                {/* Opción 2 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', color: '#555', whiteSpace: 'nowrap' }}>[2] Guardar escenario:</span>
                  <input
                    type="text"
                    placeholder="Nombre del escenario…"
                    value={srScenName}
                    onChange={e => setSrScenName(e.target.value)}
                    style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.5rem', fontSize: '0.82rem' }}
                  />
                  <button className="btn btn-primary btn-sm"
                    disabled={!srScenName.trim()}
                    onClick={guardarEscenarioSr}>Guardar</button>
                </div>

                {srSaveMsg && (
                  <div className={`alert ${srSaveMsg.startsWith('✓') ? 'alert-success' : 'alert-error'}`}
                    style={{ marginTop: '0.5rem', padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}>
                    {srSaveMsg}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Escenarios guardados */}
        {srScenarios.length > 0 && (
          <div className="card" style={{ maxWidth: 680 }}>
            <div className="card-title" style={{ marginBottom: '0.75rem' }}>
              Escenarios guardados — {srData.sku}
            </div>
            <table className="tbl" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Cadena</th>
                  <th className="num">P. Final</th>
                  <th className="num">CM2 %</th>
                  <th className="num">Utilidad</th>
                  <th>Fecha</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {srScenarios.map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                    <td>{s.cliente}</td>
                    <td className="num">${fmt(s.precio_final)}</td>
                    <td className="num" style={{ color: s.cm2_pct >= 15 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                      {fmt(s.cm2_pct, 1)}%
                    </td>
                    <td className="num">${fmt(s.utilidad)}</td>
                    <td style={{ color: '#888', fontSize: '0.78rem' }}>
                      {new Date(s.created_at).toLocaleDateString('es-CL')}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm"
                        onClick={() => eliminarEscenarioSr(s.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}
  </div>
)}
```

**Step 2: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errores.

---

## Task 8: Backend — exponer `clientes_condiciones` en explosion response

**Context:** En Task 6, `selectSrCliente` usa `srData?.clientes_orig` para obtener los valores actuales del cliente (factor, descuento, rapell, etc.). Pero `obtener_explosion` actualmente no retorna los datos crudos de `clientes_condiciones`. Necesitamos agregar esos datos al response de `/api/costos/{sku}/explosion`.

**Files:**
- Modify: `services/simulador.py` (función `obtener_explosion`, sección del return)
- Modify: `models.py` (agregar campo `clientes_orig` a `ExplosionResponse`)

**Step 1: Agregar `clientes_orig` al return de `obtener_explosion`**

En `services/simulador.py`, dentro de `obtener_explosion()`, justo antes del `return`, agregar:

```python
# Obtener datos crudos de clientes para el simulador
clientes_raw = db.execute(text("SELECT * FROM clientes_condiciones ORDER BY id")).fetchall()
clientes_orig = [dict(r._mapping) for r in clientes_raw]
```

Y en el diccionario de return, agregar:
```python
"clientes_orig": clientes_orig,
```

**Step 2: Agregar `clientes_orig` a `ExplosionResponse` en `models.py`**

Encontrar:
```python
    rentabilidad_clientes: List[RentabilidadCliente] = []
```
Agregar debajo:
```python
    clientes_orig: List[dict] = []
```

**Step 3: Verificar que el endpoint sigue funcionando**
```bash
curl http://localhost:8000/api/costos/ESMALAB001/explosion | python -m json.tool | grep clientes_orig
```
Expected: aparece la key `clientes_orig` con array de objetos.

---

## Verificación final

1. Ir a Clientes → pestaña "⚡ Simulador Rent."
2. Buscar un producto terminado (ej. "ESMALTE")
3. Verificar que aparece la tabla con todas las cadenas y su CM2 actual
4. Hacer clic en una fila → verificar que se abre el panel con valores pre-llenados
5. Modificar el factor (ej. de 1.8 a 2.0) → clic "⚡ Calcular" → verificar que los resultados simulados cambian
6. Guardar como escenario con nombre → verificar que aparece en la lista de escenarios abajo
7. Hacer clic en [1] Sobreescribir → confirmar → verificar que las condiciones de la cadena cambiaron en la BD (revisar pestaña Condiciones)
8. Hacer clic ✕ en un escenario → verificar que desaparece de la lista
