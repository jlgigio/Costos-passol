# Design: Simulador de Rentabilidad por Cadena

**Fecha:** 2026-03-28
**Estado:** Aprobado
**Tipo:** Feature — Simulador What-If Rentabilidad Comercial

---

## Objetivo

Agregar una pestaña **"Simulador Rent."** dentro del módulo Clientes que permita al usuario:
1. Buscar un SKU (Producto Terminado)
2. Ver la rentabilidad actual por cadena en una tabla resumen
3. Seleccionar una cadena y editar sus parámetros comerciales en un panel detallado
4. Recalcular la rentabilidad simulada usando el mismo motor del backend
5. Guardar los resultados como nuevas condiciones de la cadena O como escenario separado
6. Consultar escenarios guardados para el SKU actual en la misma pestaña

---

## Arquitectura

### Frontend (`frontend/src/App.tsx`)
- Nueva pestaña `cadenasTab === 'sim-rent'` dentro del módulo Clientes
- Estado local para: SKU buscado, cadena seleccionada, valores simulados por cadena, resultado del cálculo, lista de escenarios
- Panel de edición se abre al hacer clic en una fila de la tabla resumen
- "Calcular ⚡" llama a `POST /api/rentabilidad/simular` — sin lógica duplicada en frontend
- Guardar condiciones: `PUT /api/clientes/{id}` (endpoint existente)
- Guardar escenario: `POST /api/escenarios`

### Backend
- Nuevo router: `routers/escenarios.py`
- Nuevo endpoint de simulación: `POST /api/rentabilidad/simular` — reutiliza `calcular_rentabilidad_clientes()`
- CRUD de escenarios: GET, POST, DELETE en `/api/escenarios`

### Base de datos
- Nueva tabla: `escenarios_rentabilidad`
- Sin cambios en tablas existentes

---

## Flujo detallado

1. Usuario va a Clientes → pestaña "Simulador Rent."
2. Searchbar autocomplete busca SKUs tipo "Producto Terminado"
3. Al seleccionar SKU → llama `GET /api/costos/{sku}/explosion` (endpoint existente)
4. Se renderiza tabla resumen: cadena | P.Final actual | CM2% actual | Utilidad actual
5. Usuario hace clic en una fila → se abre panel debajo de la tabla
6. Panel muestra dos columnas: ACTUAL (read-only) | SIMULADO (inputs editables)
7. Inputs pre-llenados con valores actuales de `clientes_condiciones`
8. Usuario modifica → clic "Calcular ⚡" → `POST /api/rentabilidad/simular`
9. Resultado aparece en columna SIMULADO del panel
10. Sección Guardar con 2 opciones:
    - **[1] Sobreescribir condiciones** → confirmación → `PUT /api/clientes/{id}` con nuevos valores
    - **[2] Guardar escenario** → input nombre → `POST /api/escenarios`
11. Botón **Restablecer** → resetea inputs al valor actual de la cadena
12. Sección inferior: lista de escenarios guardados para el SKU actual

---

## Layout del panel de edición

```
┌─ SIMULADOR: [Nombre Cadena] ──────────────────────────────────┐
│  PARÁMETROS              ACTUAL    →    SIMULADO               │
│  Factor                  1.80          [input]                 │
│  Descuento %             5.0%          [input]                 │
│  Comisión %              3.0%          [input]                 │
│  ── Plan Comercial ──                                          │
│  Rapell %                1.0%          [input]                 │
│  Fee %                   0.5%          [input]                 │
│  Marketing %             2.0%          [input]                 │
│  X-Docking %             0.0%          [input]                 │
│  Rebate %                1.5%          [input]                 │
│  Centralización %        0.0%          [input]                 │
│  ── Logística ──                                               │
│  Flete (CLP/kg)          $45           [input]                 │
│  Pallet (CLP/kg)         $12           [input]                 │
│                                                                │
│  RESULTADOS              ACTUAL    →    SIMULADO               │
│  Precio Lista            $7.200         [calculado]            │
│  Precio Final (PNC)      $6.840         [calculado]            │
│  CM2 %                   18.5%          [calculado]            │
│  Utilidad                $1.265         [calculado]            │
│                                                                │
│  [↺ Restablecer]    [⚡ Calcular]                              │
│  ── Guardar ──────────────────────────────────────────────     │
│  [1] Sobreescribir condiciones actuales                        │
│  [2] Guardar escenario  Nombre: [input]  [Guardar]             │
└────────────────────────────────────────────────────────────────┘
```

---

## Base de datos

### Nueva tabla: `escenarios_rentabilidad`
```sql
CREATE TABLE IF NOT EXISTS escenarios_rentabilidad (
  id                    SERIAL PRIMARY KEY,
  nombre                VARCHAR(100) NOT NULL,
  sku                   VARCHAR(50),
  nombre_sku            VARCHAR(200),
  cliente_id            INTEGER,
  cliente               VARCHAR(100),
  -- Parámetros simulados
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
  -- Resultados calculados
  precio_lista          NUMERIC(12,2) DEFAULT 0,
  precio_final          NUMERIC(12,2) DEFAULT 0,
  cm2_pct               NUMERIC(8,4)  DEFAULT 0,
  utilidad              NUMERIC(12,2) DEFAULT 0,
  created_at            TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### Simulación (nuevo)
```
POST /api/rentabilidad/simular
Body: {
  sku: str,
  costo_base_clp: float,      # costo_total_con_merma del SKU
  peso_kg: float,
  familia: str,
  factor: float,
  descuento_max: float,
  comision_promedio: float,
  rapell: float, fee: float, marketing: float,
  x_docking: float, rebate: float, rebate_centralizacion: float,
  flete_kilo: float,
  pallet_kilo: float
}
Response: {
  precio_lista: float, precio_final: float,
  costo_parcial: float, comision_monto: float,
  plan_comercial_monto: float, costo_total: float,
  cm1: float, cm1_pct: float, cm2: float, cm2_pct: float,
  utilidad: float, precio_piso: float
}
```

### Escenarios (nuevos)
```
GET    /api/escenarios?sku={sku}    → lista de escenarios del SKU
POST   /api/escenarios              → crear escenario
DELETE /api/escenarios/{id}         → eliminar escenario
```

---

## Estado frontend

```typescript
// Nuevos estados en App()
const [simRentSearch, setSimRentSearch] = useState('')
const [simRentSug, setSimRentSug] = useState<any[]>([])
const [simRentSku, setSimRentSku] = useState<any>(null)       // SKU base cargado
const [simRentData, setSimRentData] = useState<any>(null)     // explosion del SKU
const [simRentSelected, setSimRentSelected] = useState<any>(null)  // cadena seleccionada
const [simRentInputs, setSimRentInputs] = useState<any>({})   // valores editados
const [simRentResult, setSimRentResult] = useState<any>(null) // resultado calculado
const [simRentLoading, setSimRentLoading] = useState(false)
const [simRentScenName, setSimRentScenName] = useState('')    // nombre escenario
const [simRentScenarios, setSimRentScenarios] = useState<any[]>([]) // escenarios guardados
const [simRentConfirm, setSimRentConfirm] = useState(false)   // confirmación opción 1
```

---

## Orden de implementación

1. **DB** — Script SQL para crear `escenarios_rentabilidad`
2. **Backend — Simulación** — `POST /api/rentabilidad/simular` en nuevo router
3. **Backend — Escenarios** — GET/POST/DELETE `/api/escenarios`
4. **Backend — main.py** — registrar nuevo router
5. **Frontend — Pestaña** — agregar tab "Simulador Rent." en el selector de pestañas de Clientes
6. **Frontend — Búsqueda** — searchbar + carga explosion del SKU + tabla resumen
7. **Frontend — Panel edición** — campos actuales vs simulados, botón Calcular, Restablecer
8. **Frontend — Guardar** — opción 1 (con confirmación) + opción 2 (con nombre)
9. **Frontend — Escenarios** — sección lista de escenarios guardados con eliminar
