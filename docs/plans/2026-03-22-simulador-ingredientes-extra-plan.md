# Simulador What-If — Agregar ingredientes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir agregar ingredientes del catálogo o de texto libre a una receta existente en el simulador What-If, enviando cantidad + costo de todos los ítems al backend para calcular el escenario.

**Architecture:** Se extiende el modelo `SimularCostosRequest` con un campo `insumos` (lista unificada). `simular_escenario()` usa esa lista directamente si está presente, ignorando el BOM de la BD para el cálculo (sigue usándolo solo para obtener `costo_actual`). El frontend agrega dos caminos de entrada: buscador de catálogo (todos los tipos) y mini-form de texto libre.

**Tech Stack:** FastAPI + Pydantic v2, SQLAlchemy text(), React 18 + TypeScript, CSS puro.

---

## Task 1: Nuevo modelo `InsumoSimulacion` en `models.py`

**Files:**
- Modify: `models.py:5-10`

**Step 1: Agregar `InsumoSimulacion` y extender `SimularCostosRequest`**

Reemplazar el bloque actual (líneas 5-10) con:

```python
class InsumoSimulacion(BaseModel):
    sku: str            # SKU real o "_libre_0", "_libre_1", etc.
    nombre: str
    cantidad: float
    costo_unitario: float

class SimularCostosRequest(BaseModel):
    # Nuevo campo principal: lista unificada de insumos con cantidad + costo
    insumos: Optional[List[InsumoSimulacion]] = None
    # Campo legacy — se mantiene para retrocompatibilidad
    nuevos_costos: Optional[Dict[str, float]] = None
    moneda_simulacion: str = "CLP"
```

**Step 2: Verificar que el import de `List` y `Optional` ya existan**

Línea 2 de `models.py`:
```python
from typing import List, Dict, Optional
```
Ya está presente. No hay nada que agregar.

**Step 3: Reiniciar servidor para validar que el modelo carga sin errores**

```bash
taskkill //IM uvicorn.exe //F && taskkill //IM python.exe //F
uvicorn main:app --port 8000
```
Esperado: arranque sin traceback.

---

## Task 2: Actualizar `simular_escenario()` en `services/simulador.py`

**Files:**
- Modify: `services/simulador.py:213-292`

**Step 1: Cambiar la firma de la función**

Reemplazar línea 213:
```python
def simular_escenario(sku: str, nuevos_costos: dict, moneda_simulacion: str, db: Session):
```
por:
```python
def simular_escenario(sku: str, moneda_simulacion: str, db: Session,
                      insumos=None, nuevos_costos: dict = None):
```

**Step 2: Reemplazar la lógica de cálculo del costo simulado**

La sección actual (líneas 214-241) obtiene el BOM y parchea costos con `nuevos_costos`. Reemplazarla con:

```python
    # 1. Obtener costo actual del BOM real (para calcular variación)
    query = text("SELECT * FROM explotar_costo_sku(:sku)")
    result = db.execute(query, {"sku": sku}).fetchall()

    if not result and not insumos:
        raise ValueError("El SKU no existe o no tiene insumos en su receta.")

    df_base = pd.DataFrame([dict(row._mapping) for row in result]) if result else pd.DataFrame()
    for col in ['cantidad_requerida_formato', 'costo_unitario_clp_actual', 'costo_teorico_total_clp']:
        if col in df_base.columns:
            df_base[col] = df_base[col].astype(float)
    costo_actual_total_clp = df_base['costo_teorico_total_clp'].sum() if not df_base.empty else 0.0

    # 2. Calcular costo simulado
    if insumos:
        # Nuevo modo: lista unificada (cantidad + costo por ítem)
        costo_proyectado_total_clp = sum(
            float(i.cantidad) * float(i.costo_unitario) for i in insumos
        )
    else:
        # Modo legacy: parchear costos sobre el BOM
        df_simulado = df_base.copy()
        for insumo_sku, costo_sim in (nuevos_costos or {}).items():
            mask = df_simulado['insumo_final'] == insumo_sku
            df_simulado.loc[mask, 'costo_unitario_clp_actual'] = float(costo_sim)
            df_simulado.loc[mask, 'costo_teorico_total_clp'] = (
                df_simulado.loc[mask, 'cantidad_requerida_formato'] *
                df_simulado.loc[mask, 'costo_unitario_clp_actual']
            )
        costo_proyectado_total_clp = df_simulado['costo_teorico_total_clp'].sum()
```

**Step 3: El resto de la función (paso 4 en adelante) no cambia**

Las líneas 242-292 (parámetros, peso, flete, variación, rentabilidades) quedan igual.

**Step 4: Verificar arranque del servidor**

```bash
taskkill //IM uvicorn.exe //F && taskkill //IM python.exe //F
uvicorn main:app --port 8000
```
Esperado: arranque sin traceback.

---

## Task 3: Actualizar el endpoint en `routers/costos.py`

**Files:**
- Modify: `routers/costos.py:54-107`

**Step 1: Cambiar la llamada a `simular_escenario`**

Reemplazar línea 61:
```python
resultado_simulacion = simular_escenario(sku, payload.nuevos_costos, payload.moneda_simulacion, db)
```
por:
```python
resultado_simulacion = simular_escenario(
    sku,
    payload.moneda_simulacion,
    db,
    insumos=payload.insumos,
    nuevos_costos=payload.nuevos_costos,
)
```

**Step 2: Agregar import del nuevo modelo en `routers/costos.py`**

Verificar que `InsumoSimulacion` no necesita importarse explícitamente (solo se usa dentro de `SimularCostosRequest` que ya se importa). No requiere cambio adicional.

**Step 3: Reiniciar y probar con curl (simulación básica)**

```bash
curl -X POST http://localhost:8000/api/costos/PT-001/simulacion \
  -H "Content-Type: application/json" \
  -d '{"insumos": [{"sku": "INS-001", "nombre": "Test", "cantidad": 1.0, "costo_unitario": 1000}], "moneda_simulacion": "CLP"}'
```
Esperado: respuesta JSON con `Costo_Simulado_CLP`, `Costo_Final_CLP`, etc. (usar un SKU real de la BD).

---

## Task 4: Nuevos estados en `frontend/src/App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx:~154-162`

**Step 1: Agregar estados para ítems libres**

Después de la línea `const [simAddSug, setSimAddSug] = useState<any[]>([])` (~línea 155), agregar:

```typescript
// Simulador — ítems de texto libre (sin SKU en BD)
const [simLibreItems, setSimLibreItems] = useState<
  { id: string; nombre: string; cantidad: number; costo: number }[]
>([])
const [simLibreNombre, setSimLibreNombre] = useState('')
const [simLibreCantidad, setSimLibreCantidad] = useState<number>(0)
const [simLibreCosto, setSimLibreCosto] = useState<number>(0)
const [simLibreOpen, setSimLibreOpen] = useState(false)
```

---

## Task 5: Actualizar `simAddSearchFn` para buscar todos los tipos

**Files:**
- Modify: `frontend/src/App.tsx:~311-316`

**Step 1: Quitar el filtro `&tipo=Insumo`**

Reemplazar:
```typescript
const r = await fetch(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}&tipo=Insumo`)
```
por:
```typescript
const r = await fetch(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}`)
```

Esto permite agregar cualquier tipo de SKU (Insumo, Sub-receta, PT) al escenario.

---

## Task 6: Función para agregar ítem libre

**Files:**
- Modify: `frontend/src/App.tsx` (después de `simAddInsumo`, ~línea 325)

**Step 1: Agregar función `simAddLibre`**

```typescript
const simAddLibre = () => {
  if (!simLibreNombre.trim() || simLibreCantidad <= 0) return
  const id = `_libre_${simLibreItems.length}`
  setSimLibreItems(prev => [...prev, {
    id,
    nombre: simLibreNombre.trim(),
    cantidad: simLibreCantidad,
    costo: simLibreCosto
  }])
  setSimLibreNombre('')
  setSimLibreCantidad(0)
  setSimLibreCosto(0)
  setSimLibreOpen(false)
}

const simRemoveLibre = (id: string) => {
  setSimLibreItems(prev => prev.filter(it => it.id !== id))
}
```

---

## Task 7: Actualizar `clearExplosion` para resetear estados libres

**Files:**
- Modify: `frontend/src/App.tsx` — función `clearExplosion` o donde se hace limpiar el simulador

**Step 1: Buscar dónde se limpia el simulador**

Buscar `clearExplosion` o el handler del botón `✕ Limpiar` del simulador. Agregar al reset:
```typescript
setSimLibreItems([])
setSimLibreNombre('')
setSimLibreCantidad(0)
setSimLibreCosto(0)
setSimLibreOpen(false)
```

---

## Task 8: Actualizar `handleSimular` — nuevo payload

**Files:**
- Modify: `frontend/src/App.tsx:~284-293`

**Step 1: Reemplazar la construcción del payload**

Reemplazar el bloque actual:
```typescript
const nuevos_costos: { [k: string]: number } = {}
Object.keys(simInputs).forEach(k => { nuevos_costos[k] = simInputs[k].costo })
const r = await fetch(`${API}/api/costos/${skuSim}/simulacion`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nuevos_costos, moneda_simulacion: 'CLP' })
})
```
por:
```typescript
const insumos = [
  ...Object.keys(simInputs).map(sku => ({
    sku,
    nombre: simInputs[sku].nombre || '',
    cantidad: simInputs[sku].cantidad,
    costo_unitario: simInputs[sku].costo,
  })),
  ...simLibreItems.map(it => ({
    sku: it.id,
    nombre: it.nombre,
    cantidad: it.cantidad,
    costo_unitario: it.costo,
  }))
]
const r = await fetch(`${API}/api/costos/${skuSim}/simulacion`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ insumos, moneda_simulacion: 'CLP' })
})
```

---

## Task 9: UI — Botón "Agregar libre" + mini-form

**Files:**
- Modify: `frontend/src/App.tsx` — sección What-If (~línea 1037-1064)

**Step 1: Agregar botón y form después del buscador de catálogo**

Después del div del buscador de catálogo (`simAddSearch`), agregar:

```tsx
{/* Botón agregar libre */}
<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
  <button
    className="btn btn-ghost btn-sm"
    onClick={() => setSimLibreOpen(o => !o)}
  >
    {simLibreOpen ? '✕ Cancelar' : '+ Agregar libre'}
  </button>
</div>

{/* Mini-form inline */}
{simLibreOpen && (
  <div style={{
    display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
    marginBottom: '0.75rem', padding: '0.75rem',
    background: '#fffbeb', borderRadius: 8,
    border: '1px solid var(--border)'
  }}>
    <div className="field" style={{ flex: 2, marginBottom: 0 }}>
      <label style={{ fontSize: '0.72rem' }}>Nombre del insumo</label>
      <input type="text" placeholder="Ej: Solvente especial X"
        value={simLibreNombre}
        onChange={e => setSimLibreNombre(e.target.value)}
        style={{ width: '100%' }} />
    </div>
    <div className="field" style={{ flex: '0 0 110px', marginBottom: 0 }}>
      <label style={{ fontSize: '0.72rem' }}>Cantidad</label>
      <input type="number" min={0} step="any"
        value={simLibreCantidad || ''}
        onChange={e => setSimLibreCantidad(parseFloat(e.target.value) || 0)}
        style={{ width: '100%', textAlign: 'right' }} />
    </div>
    <div className="field" style={{ flex: '0 0 130px', marginBottom: 0 }}>
      <label style={{ fontSize: '0.72rem' }}>Costo Unit. ($)</label>
      <input type="number" min={0} step="any"
        value={simLibreCosto || ''}
        onChange={e => setSimLibreCosto(parseFloat(e.target.value) || 0)}
        style={{ width: '100%', textAlign: 'right' }} />
    </div>
    <button className="btn btn-primary btn-sm"
      onClick={simAddLibre}
      disabled={!simLibreNombre.trim() || simLibreCantidad <= 0}>
      ✓ Agregar
    </button>
  </div>
)}
```

---

## Task 10: UI — Extender tabla para mostrar ítems libres

**Files:**
- Modify: `frontend/src/App.tsx` — tbody de la tabla What-If (~línea 1090-1115)

**Step 1: Agregar filas de ítems libres después de las filas de `simInputs`**

Después del cierre del `.map` de `simInputs` y antes del `</tbody>`, agregar:

```tsx
{/* Ítems libres */}
{simLibreItems.map(it => {
  const subtotal = it.cantidad * it.costo
  return (
    <tr key={it.id} style={{ background: '#fffbeb', borderLeft: '3px solid var(--warning)' }}>
      <td>
        <span className="fw-600 text-xs text-muted">—</span>
        <span className="badge badge-yellow" style={{ marginLeft: 6 }}>Libre</span>
      </td>
      <td className="text-sm">{it.nombre}</td>
      <td className="num">
        <input type="number" style={{ width: 90, textAlign: 'right' }}
          value={it.cantidad}
          onChange={e => setSimLibreItems(prev =>
            prev.map(x => x.id === it.id
              ? { ...x, cantidad: parseFloat(e.target.value) || 0 }
              : x
            )
          )} />
      </td>
      <td className="num">
        <input type="number" style={{ width: 100, textAlign: 'right' }}
          value={it.costo}
          onChange={e => setSimLibreItems(prev =>
            prev.map(x => x.id === it.id
              ? { ...x, costo: parseFloat(e.target.value) || 0 }
              : x
            )
          )} />
      </td>
      <td className="num fw-600" style={{ color: 'var(--primary)' }}>${fmt(subtotal, 2)}</td>
      <td className="ctr">
        <button className="btn btn-danger btn-sm" onClick={() => simRemoveLibre(it.id)}>✕</button>
      </td>
    </tr>
  )
})}
```

---

## Task 11: Verificar TypeScript y probar flujo completo

**Step 1: Chequeo TypeScript**

```bash
cd frontend && npx tsc --noEmit
```
Esperado: sin errores.

**Step 2: Reiniciar backend**

```bash
taskkill //IM uvicorn.exe //F && taskkill //IM python.exe //F
uvicorn main:app --port 8000
```

**Step 3: Reiniciar frontend (si no está corriendo)**

```bash
cd frontend && npm run dev
```

**Step 4: Prueba manual en http://localhost:5173**

1. Ir a Simulador → Receta existente
2. Buscar un PT con BOM, cargarlo
3. Agregar un insumo del catálogo (buscador)
4. Agregar un ítem libre (nombre: "Solvente Test", cantidad: 0.5, costo: 900)
5. Hacer clic en "Calcular escenario"
6. Verificar que los stat-boxes muestran `Costo MP simulado` y `Costo final nuevo` con valores coherentes

---

## Notas de implementación

- Los ítems `_libre_N` nunca llegan a la BD; son temporales en memoria del frontend
- El backend ignora el BOM para el cálculo cuando `insumos` viene en el payload; solo lo usa para `costo_actual_total_clp` (la variación)
- El campo `nuevos_costos` queda como legacy para no romper clientes que puedan existir
- Si `insumos` llega vacío `[]`, `costo_proyectado = 0` lo cual es correcto (receta vacía)
