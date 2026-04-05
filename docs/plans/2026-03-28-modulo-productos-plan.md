# Módulo Productos — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a new "Productos" module in the main menu with tabs for product-specific parameters (Ficha) and cost history (Historial).

**Architecture:** New `condiciones_producto` DB table stores per-SKU parameters. A new FastAPI router (`routers/productos.py`) exposes GET/PUT for ficha and GET for historial. The frontend adds `'productos'` to `ViewState`, a topbar button, SKU search, and two tabs.

**Tech Stack:** FastAPI + SQLAlchemy (text queries) + Pydantic, React 18 + TypeScript, PostgreSQL

---

### Task 1: DB — Crear tabla condiciones_producto

**Files:**
- Create: `migracion_productos.py`

**Step 1: Crear script de migración**

```python
# migracion_productos.py
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS condiciones_producto (
            sku                   VARCHAR(50) PRIMARY KEY REFERENCES maestro_skus(sku),
            precio_venta_sugerido NUMERIC(15,2),
            precio_piso           NUMERIC(15,2),
            margen_objetivo_pct   NUMERIC(5,2),
            clasificacion         VARCHAR(100),
            notas                 TEXT,
            updated_at            TIMESTAMP DEFAULT NOW()
        )
    """))
    conn.commit()
    print("Tabla condiciones_producto creada correctamente.")
```

**Step 2: Ejecutar migración**

```bash
python migracion_productos.py
```

Resultado esperado: `Tabla condiciones_producto creada correctamente.`

**Step 3: Verificar en psql (opcional)**

```sql
\d condiciones_producto
```

**Step 4: Commit**

```bash
git add migracion_productos.py
git commit -m "feat: add condiciones_producto migration script"
```

---

### Task 2: Backend — Modelos Pydantic

**Files:**
- Modify: `models.py` (agregar al final)

**Step 1: Agregar modelos al final de `models.py`**

```python
class CondicionProducto(BaseModel):
    sku: str = ""
    precio_venta_sugerido: Optional[float] = None
    precio_piso: Optional[float] = None
    margen_objetivo_pct: Optional[float] = None
    clasificacion: Optional[str] = None
    notas: Optional[str] = None

class HistorialCostoItem(BaseModel):
    fecha: str
    costo_unitario_clp: float
    costo_unitario_usd: float
    fuente: str  # 'compra' | 'manual'
    proveedor: Optional[str] = None
```

**Step 2: Verificar que `Optional` ya está importado** — línea 2 de `models.py` ya tiene `from typing import List, Dict, Optional, Literal`. OK.

**Step 3: Commit**

```bash
git add models.py
git commit -m "feat: add CondicionProducto and HistorialCostoItem pydantic models"
```

---

### Task 3: Backend — Router productos

**Files:**
- Create: `routers/productos.py`

**Step 1: Crear router**

```python
# routers/productos.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db
from models import CondicionProducto, HistorialCostoItem
from typing import List

router_productos = APIRouter(prefix="/api/productos", tags=["Productos"])

@router_productos.get("/{sku}/ficha", response_model=CondicionProducto)
def get_ficha(sku: str, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM condiciones_producto WHERE sku = :sku"),
        {"sku": sku}
    ).fetchone()
    if not row:
        return CondicionProducto(sku=sku)
    d = dict(row._mapping)
    return CondicionProducto(
        sku=d["sku"],
        precio_venta_sugerido=d.get("precio_venta_sugerido"),
        precio_piso=d.get("precio_piso"),
        margen_objetivo_pct=d.get("margen_objetivo_pct"),
        clasificacion=d.get("clasificacion"),
        notas=d.get("notas"),
    )

@router_productos.put("/{sku}/ficha", response_model=CondicionProducto)
def upsert_ficha(sku: str, payload: CondicionProducto, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO condiciones_producto
            (sku, precio_venta_sugerido, precio_piso, margen_objetivo_pct, clasificacion, notas, updated_at)
        VALUES
            (:sku, :precio_venta_sugerido, :precio_piso, :margen_objetivo_pct, :clasificacion, :notas, NOW())
        ON CONFLICT (sku) DO UPDATE SET
            precio_venta_sugerido = EXCLUDED.precio_venta_sugerido,
            precio_piso           = EXCLUDED.precio_piso,
            margen_objetivo_pct   = EXCLUDED.margen_objetivo_pct,
            clasificacion         = EXCLUDED.clasificacion,
            notas                 = EXCLUDED.notas,
            updated_at            = NOW()
    """), {
        "sku": sku,
        "precio_venta_sugerido": payload.precio_venta_sugerido,
        "precio_piso":           payload.precio_piso,
        "margen_objetivo_pct":   payload.margen_objetivo_pct,
        "clasificacion":         payload.clasificacion,
        "notas":                 payload.notas,
    })
    db.commit()
    payload.sku = sku
    return payload

@router_productos.get("/{sku}/historial", response_model=List[HistorialCostoItem])
def get_historial(sku: str, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT
            ch.fecha_compra::text  AS fecha,
            ch.costo_unitario      AS costo_unitario_clp,
            CASE WHEN tc.valor_usd > 0
                 THEN ROUND(ch.costo_unitario / tc.valor_usd, 6)
                 ELSE 0 END        AS costo_unitario_usd,
            'compra'               AS fuente,
            ch.proveedor
        FROM costos_historicos ch
        LEFT JOIN LATERAL (
            SELECT valor_usd FROM tipos_cambio
            WHERE fecha <= ch.fecha_compra
            ORDER BY fecha DESC LIMIT 1
        ) tc ON true
        WHERE ch.sku = :sku
        ORDER BY ch.fecha_compra DESC
        LIMIT 50
    """), {"sku": sku}).fetchall()

    result = []
    for r in rows:
        d = dict(r._mapping)
        result.append(HistorialCostoItem(
            fecha=d["fecha"],
            costo_unitario_clp=float(d["costo_unitario_clp"] or 0),
            costo_unitario_usd=float(d["costo_unitario_usd"] or 0),
            fuente=d["fuente"],
            proveedor=d.get("proveedor"),
        ))
    return result
```

**Step 2: Commit**

```bash
git add routers/productos.py
git commit -m "feat: add productos router with ficha and historial endpoints"
```

---

### Task 4: Backend — Registrar router en main.py

**Files:**
- Modify: `main.py`

**Step 1: Agregar import y registro**

En `main.py`, después de la línea `from routers.escenarios import router_simulacion, router_escenarios`:

```python
from routers.productos import router_productos
```

Y después de `app.include_router(router_escenarios)`:

```python
app.include_router(router_productos)
```

**Step 2: Reiniciar backend y verificar**

```bash
# Matar proceso existente
powershell -Command "Get-Process python | Stop-Process -Force"
uvicorn main:app --reload --port 8000
```

Verificar en `http://localhost:8000/docs` que aparecen los endpoints `/api/productos/{sku}/ficha` y `/api/productos/{sku}/historial`.

**Step 3: Commit**

```bash
git add main.py
git commit -m "feat: register router_productos in main app"
```

---

### Task 5: Frontend — Estado, ViewState y topbar

**Files:**
- Modify: `frontend/src/App.tsx` (líneas 4, 1078-1081)

**Step 1: Extender ViewState (línea 4)**

Cambiar:
```typescript
type ViewState = 'cover' | 'import' | 'parametros' | 'clientes' | 'consulta' | 'simulador' | 'manuales'
```
Por:
```typescript
type ViewState = 'cover' | 'import' | 'parametros' | 'clientes' | 'consulta' | 'simulador' | 'manuales' | 'productos'
```

**Step 2: Agregar al topbar (línea 1078)**

Cambiar:
```typescript
{(['import','parametros','clientes','consulta','simulador','manuales'] as ViewState[]).map(v => (
  <button key={v} className={`topbar-btn ${view === v ? 'active' : ''}`} onClick={() => go(v)}>
    {{ import:'BD ERP', parametros:'Parámetros', clientes:'Cadenas',
       consulta:'Consulta', simulador:'Simulador', manuales:'Costos Manuales' }[v]}
```
Por:
```typescript
{(['import','parametros','clientes','productos','consulta','simulador','manuales'] as ViewState[]).map(v => (
  <button key={v} className={`topbar-btn ${view === v ? 'active' : ''}`} onClick={() => go(v)}>
    {{ import:'BD ERP', parametros:'Parámetros', clientes:'Cadenas', productos:'Productos',
       consulta:'Consulta', simulador:'Simulador', manuales:'Costos Manuales' }[v]}
```

**Step 3: Agregar estados del módulo** (después de los estados de clientes, ~línea 255)

```typescript
// ── Módulo Productos ──────────────────────────────────────────
const [prodTab, setProdTab]             = useState<'ficha' | 'historial'>('ficha')
const [prodSearch, setProdSearch]       = useState('')
const [prodSug, setProdSug]             = useState<any[]>([])
const [prodSku, setProdSku]             = useState('')
const [prodNombre, setProdNombre]       = useState('')
const [prodFicha, setProdFicha]         = useState<any>(null)
const [prodHistorial, setProdHistorial] = useState<any[]>([])
const [prodLoading, setProdLoading]     = useState(false)
const [prodSaving, setProdSaving]       = useState(false)
const [prodSaveMsg, setProdSaveMsg]     = useState('')
const [prodEdit, setProdEdit]           = useState<any>({})
```

**Step 4: Agregar funciones del módulo** (junto a las otras funciones, antes del return)

```typescript
const searchProdSku = async (q: string) => {
  setProdSearch(q); setProdSku(''); setProdNombre(''); setProdFicha(null); setProdHistorial([])
  if (q.length < 2) { setProdSug([]); return }
  const r = await fetch(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto+Terminado`)
  if (r.ok) setProdSug(await r.json())
}

const selectProdSku = async (sku: string, nombre: string) => {
  setProdSearch(nombre); setProdSku(sku); setProdNombre(nombre)
  setProdSug([]); setProdLoading(true); setProdSaveMsg('')
  const [fR, hR] = await Promise.all([
    fetch(`${API}/api/productos/${sku}/ficha`),
    fetch(`${API}/api/productos/${sku}/historial`),
  ])
  if (fR.ok) { const d = await fR.json(); setProdFicha(d); setProdEdit({ ...d }) }
  if (hR.ok) setProdHistorial(await hR.json())
  setProdLoading(false)
}

const saveProdFicha = async () => {
  if (!prodSku) return
  setProdSaving(true); setProdSaveMsg('')
  const r = await fetch(`${API}/api/productos/${prodSku}/ficha`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prodEdit)
  })
  if (r.ok) { const d = await r.json(); setProdFicha(d); setProdSaveMsg('✓ Guardado correctamente') }
  else setProdSaveMsg('⚠ Error al guardar')
  setProdSaving(false)
}
```

**Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add productos ViewState, topbar button, states and API functions"
```

---

### Task 6: Frontend — Renderizado del módulo Productos

**Files:**
- Modify: `frontend/src/App.tsx` (sección de views, después del bloque `clientes`)

**Step 1: Localizar dónde termina el bloque `clientes`**

Buscar `{view === 'clientes' && (` y encontrar su cierre `)}`. El nuevo bloque va inmediatamente después.

**Step 2: Agregar JSX del módulo Productos**

```tsx
{view === 'productos' && (
  <div className="card">
    <div className="card-title">📦 Productos</div>

    {/* Buscador */}
    <div className="searchbar" style={{ marginBottom: '1rem', maxWidth: 520 }}>
      <span className="sb-label">Producto</span>
      <div className="sb-divider" />
      <div className="sb-input-wrap">
        <input type="text" placeholder="Buscar por código o nombre…"
          value={prodSearch} onChange={e => searchProdSku(e.target.value)} autoComplete="off" />
        {prodSug.length > 0 && (
          <div className="autocomplete-dropdown">
            {prodSug.map((s, i) => (
              <div key={i} className="autocomplete-item" onClick={() => selectProdSku(s.sku, s.nombre)}>
                <span className="ac-sku">{s.sku}</span>
                <span className="ac-name">{s.nombre}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* Info del producto seleccionado */}
    {prodSku && (
      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{prodSku}</span>
        <span style={{ color: '#666', marginLeft: 8 }}>{prodNombre}</span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}
          onClick={() => { setProdSku(''); setProdNombre(''); setProdSearch(''); setProdFicha(null); setProdHistorial([]) }}>
          ✕ Limpiar
        </button>
      </div>
    )}

    {prodLoading && <div className="empty-state">Cargando…</div>}

    {prodSku && !prodLoading && (
      <>
        {/* Tabs */}
        <div className="mode-tabs" style={{ marginBottom: '1rem' }}>
          {(['ficha', 'historial'] as const).map(t => (
            <button key={t} className={`mode-tab ${prodTab === t ? 'active' : ''}`}
              onClick={() => setProdTab(t)}>
              {{ ficha: 'Ficha del producto', historial: 'Historial de costos' }[t]}
            </button>
          ))}
        </div>

        {/* TAB: Ficha */}
        {prodTab === 'ficha' && (
          <div style={{ maxWidth: 680 }}>
            <div className="form-grid cols-2" style={{ marginBottom: '1rem' }}>
              <div className="field">
                <label>Precio Venta Sugerido (CLP)</label>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                  <span style={{ padding: '0 6px', color: '#888', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                  <input type="number" className="no-spin" placeholder="0" step="1"
                    value={prodEdit.precio_venta_sugerido || ''}
                    onChange={e => setProdEdit({ ...prodEdit, precio_venta_sugerido: parseFloat(e.target.value) || null })}
                    style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                </div>
              </div>
              <div className="field">
                <label>Precio Piso (CLP)</label>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                  <span style={{ padding: '0 6px', color: '#888', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                  <input type="number" className="no-spin" placeholder="0" step="1"
                    value={prodEdit.precio_piso || ''}
                    onChange={e => setProdEdit({ ...prodEdit, precio_piso: parseFloat(e.target.value) || null })}
                    style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                </div>
              </div>
              <div className="field">
                <label>Margen Objetivo %</label>
                <input type="number" className="no-spin" placeholder="0" step="0.1"
                  value={prodEdit.margen_objetivo_pct || ''}
                  onChange={e => setProdEdit({ ...prodEdit, margen_objetivo_pct: parseFloat(e.target.value) || null })} />
              </div>
              <div className="field">
                <label>Clasificación / Línea</label>
                <input type="text" placeholder="Ej: Látex Premium, Esmalte…"
                  value={prodEdit.clasificacion || ''}
                  onChange={e => setProdEdit({ ...prodEdit, clasificacion: e.target.value || null })} />
              </div>
            </div>
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label>Notas</label>
              <textarea rows={3} placeholder="Observaciones, restricciones, notas internas…"
                value={prodEdit.notas || ''}
                onChange={e => setProdEdit({ ...prodEdit, notas: e.target.value || null })}
                style={{ width: '100%', padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.85rem', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button className="btn btn-primary btn-sm" onClick={saveProdFicha} disabled={prodSaving}>
                {prodSaving ? 'Guardando…' : 'Guardar ficha'}
              </button>
              {prodSaveMsg && (
                <span style={{ fontSize: '0.8rem', color: prodSaveMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
                  {prodSaveMsg}
                </span>
              )}
            </div>
          </div>
        )}

        {/* TAB: Historial */}
        {prodTab === 'historial' && (
          prodHistorial.length === 0
            ? <div className="empty-state">Sin historial de compras para este SKU</div>
            : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="num">Costo CLP</th>
                      <th className="num">Costo USD</th>
                      <th>Fuente</th>
                      <th>Proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodHistorial.map((h, i) => (
                      <tr key={i}>
                        <td>{h.fecha}</td>
                        <td className="num fw-600">{fmtCLP(h.costo_unitario_clp, 2)}</td>
                        <td className="num" style={{ color: '#2563eb' }}>{fmtUSD(h.costo_unitario_usd, 4)}</td>
                        <td><span className={`badge ${h.fuente === 'compra' ? 'badge-green' : 'badge-blue'}`}>{h.fuente}</span></td>
                        <td style={{ color: '#666' }}>{h.proveedor || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </>
    )}

    {!prodSku && !prodLoading && (
      <div className="empty-state">Busca un producto para ver su ficha y historial</div>
    )}
  </div>
)}
```

**Step 3: Verificar TypeScript**

```bash
cd frontend
npx tsc --noEmit
```

Resultado esperado: sin errores.

**Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add Productos module UI with Ficha and Historial tabs"
```

---

## Verificación final

1. Reiniciar backend: `uvicorn main:app --reload --port 8000`
2. Abrir `http://localhost:5173`
3. Click en "Productos" en el topbar
4. Buscar un SKU de tipo Producto Terminado
5. En pestaña "Ficha": ingresar precio venta sugerido, precio piso, margen objetivo → Guardar → verificar mensaje ✓
6. Recargar página, buscar mismo SKU → verificar que los datos persisten
7. En pestaña "Historial": verificar tabla de compras del SKU (o mensaje "Sin historial")
