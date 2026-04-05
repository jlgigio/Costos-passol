# Diseño: Simulador — Agregar ingredientes al escenario What-If

**Fecha:** 2026-03-22
**Módulo:** Simulador → Receta existente
**Estado:** Aprobado

---

## Objetivo

Permitir que el usuario agregue ingredientes a una receta existente durante la simulación What-If, con dos modalidades:

1. **Del catálogo** — ingredientes que ya existen en `maestro_skus` (cualquier tipo)
2. **Libre** — ingredientes que no están en la BD (nombre + cantidad + costo libre)

Además, las cantidades editadas por el usuario (de todos los ingredientes, originales y nuevos) deben enviarse al backend y usarse en el cálculo.

---

## Decisiones de diseño

### Enfoque elegido: Lista unificada de insumos (Enfoque B)

El payload de simulación pasa de `{nuevos_costos: {sku: cost}}` a `{insumos: [{sku, nombre, cantidad, costo_unitario}]}`.

**Razón:** El frontend ya posee todos los datos (cantidad + costo por fila). Enviar la lista completa elimina la ambigüedad y simplifica el backend, que ya no necesita re-consultar el BOM para calcular — solo lo usa para la carga inicial.

---

## Cambios por capa

### 1. `models.py`

```python
class InsumoSimulacion(BaseModel):
    sku: str           # SKU real o "_libre_0", "_libre_1", etc.
    nombre: str
    cantidad: float
    costo_unitario: float

class SimularCostosRequest(BaseModel):
    insumos: List[InsumoSimulacion]
    moneda_simulacion: str = "CLP"
    nuevos_costos: Optional[Dict[str, float]] = None  # backward compat
```

### 2. `services/simulador.py` — `simular_escenario()`

- Si `insumos` viene en el payload → calcular `costo_simulado = sum(i.cantidad * i.costo_unitario)`
- `costo_actual` sigue tomándose del BOM real en BD (para mostrar la variación)
- Flete, REP, gastos indirectos: sin cambios (usan `peso_kilos` del producto en BD)
- Backward compat: si solo viene `nuevos_costos`, usar flujo actual

### 3. `frontend/src/App.tsx`

#### Nuevos estados
```typescript
const [simLibreItems, setSimLibreItems] = useState<
  { id: string; nombre: string; cantidad: number; costo: number }[]
>([])
const [simLibreNombre, setSimLibreNombre] = useState('')
const [simLibreCantidad, setSimLibreCantidad] = useState(0)
const [simLibreCosto, setSimLibreCosto] = useState(0)
const [simLibreOpen, setSimLibreOpen] = useState(false)
```

#### UI
- Buscador de catálogo actual (`simAddSearch`) se amplía a todos los tipos (sin filtro `tipo=Insumo`)
- Se agrega botón `[ + Agregar libre ]` que despliega mini-form inline:
  - Campos: Nombre · Cantidad · Costo Unit. · botón `[✓ Agregar]`
  - Al confirmar: genera `id = "_libre_N"`, agrega a `simLibreItems`, cierra el form
- Tabla unificada: muestra `simInputs` + `simLibreItems`
  - Ítems libres: SKU = `—`, badge `Libre` (amarillo), botón `✕`

#### `handleSimular` — nuevo payload
```typescript
const insumos = [
  ...Object.keys(simInputs).map(sku => ({
    sku,
    nombre: simInputs[sku].nombre || '',
    cantidad: simInputs[sku].cantidad,
    costo_unitario: simInputs[sku].costo
  })),
  ...simLibreItems.map(it => ({
    sku: it.id,
    nombre: it.nombre,
    cantidad: it.cantidad,
    costo_unitario: it.costo
  }))
]
// POST { insumos, moneda_simulacion: "CLP" }
```

#### Limpieza de estado
Al hacer `clearExplosion()` o `✕ Limpiar`: también resetear `simLibreItems`, `simLibreOpen` y campos del form libre.

---

## Flujo completo

```
1. Usuario carga receta → loadExplosion() → simInputs poblado (sin isNew)
2. Agrega del catálogo → simAddSearchFn() → simAddInsumo() → simInputs[sku] = {isNew: true}
3. Agrega libre → mini-form → simLibreItems.push({id: "_libre_N", ...})
4. Edita cantidad/costo en tabla → setSimInputs / setSimLibreItems
5. Calcular → handleSimular() → POST { insumos: [...], moneda: "CLP" }
6. Backend: costo_simulado = sum(cantidad * costo_unitario) de la lista recibida
7. UI muestra stat-boxes con variación y márgenes por cliente
```

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `models.py` | Nuevo modelo `InsumoSimulacion`, extender `SimularCostosRequest` |
| `services/simulador.py` | `simular_escenario()` acepta lista de insumos |
| `routers/costos.py` | Endpoint `/simulacion` adaptar a nuevo modelo |
| `frontend/src/App.tsx` | Estados, UI y `handleSimular` |

---

## No incluido en este alcance

- Persistencia de escenarios simulados
- Comparación lado a lado receta original vs simulada
- Exportar resultado a Excel
