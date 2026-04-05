# CLAUDE.md — PASSOL Sistema de Costeo

Guía de contexto para Claude Code al trabajar en este proyecto.

---

## Descripción del proyecto

Sistema interno de costeo y simulación de recetas para **Passol Pinturas**.
Calcula el costo de producción de productos terminados mediante explosión BOM multinivel,
simula escenarios What-If y proyecta márgenes por canal de venta.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend API | FastAPI (Python 3.11+) |
| ORM / DB driver | SQLAlchemy + psycopg2 |
| Base de datos | PostgreSQL local |
| Frontend | React 18 + TypeScript + Vite |
| Estilos | CSS puro con variables (sin framework) |
| Fuente | DM Sans (Google Fonts) |

---

## Comandos para desarrollo

```bash
# Backend (desde raíz del proyecto)
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm run dev          # Puerto 5173

# Aplicar schema SQL a la BD
python init_db_directo.py

# Aplicar función SQL específica
# (ejecutar fix_func.sql via psycopg2 o psql)
```

---

## Estructura de archivos

```
PASSOL_COSTEO_DEV/
├── main.py                   # FastAPI app + CORS + routers
├── models.py                 # Modelos Pydantic (request/response)
├── database.py               # SQLAlchemy engine y get_db
├── schema.sql                # Esquema completo de la BD
├── fix_func.sql              # Función explotar_costo_sku (actualizada)
├── init_db_directo.py        # Aplica schema.sql via psycopg2
├── routers/
│   ├── costos.py             # Endpoints: buscar, explosion, simulacion, manuales, clientes, parametros
│   └── upload.py             # Endpoint: POST /api/upload/excel
├── services/
│   ├── simulador.py          # obtener_explosion(), simular_escenario()
│   └── excel_processor.py    # Procesamiento de archivos ERP
└── frontend/
    └── src/
        ├── App.tsx           # Toda la UI (un solo archivo, ~1000 líneas)
        └── index.css         # Design system completo
```

---

## Base de datos — tablas principales

| Tabla | Descripción |
|-------|------------|
| `maestro_skus` | Catálogo de SKUs (tipo: Producto Terminado, Insumo, Sub-receta) |
| `recetas_bom` | Relaciones padre-hijo con cantidad_neta y porcentaje_merma |
| `costos_historicos` | Historial de precios de compra por SKU |
| `costos_manuales` | Costos ingresados manualmente (insumos sin compras) |
| `parametros_comerciales` | Valores globales: flete/kg, REP, gastos indirectos |
| `clientes_condiciones` | Condiciones comerciales por cliente (factor, descuentos, rebates) |

### Vistas y funciones clave

```sql
-- Vista que une el último costo de compra con el costo manual
vista_ultimo_costo  →  FULL OUTER JOIN costos_historicos + costos_manuales
                        columnas: sku, costo_unitario_clp, costo_unitario_usd, fuente_costo

-- Función recursiva que explota la BOM
explotar_costo_sku(p_sku VARCHAR)
  RETURNS TABLE (insumo_final, nombre_insumo, cantidad_requerida_base,
                 cantidad_requerida_formato, costo_unitario_clp_actual,
                 costo_unitario_usd_actual, costo_teorico_total_clp,
                 costo_teorico_total_usd, fuente_costo)
```

### Valores de `fuente_costo`
- `'compra'` — precio tomado de la última orden de compra
- `'manual'` — precio ingresado manualmente por el usuario
- `'sin_precio'` — sin precio en ninguna fuente

---

## API endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/costos/buscar?q=&tipo=` | Autocompletado de SKUs |
| GET | `/api/costos/{sku}/explosion` | Explosión BOM completa |
| POST | `/api/costos/{sku}/simulacion` | What-If con nuevos costos |
| POST | `/api/costos/simular_nuevo` | Simulación de nueva receta |
| GET | `/api/costos/sin_precio` | Insumos sin precio asignado |
| POST | `/api/costos/manual` | Asignar costo manual a insumo |
| GET | `/api/parametros/` | Obtener parámetros globales |
| PUT | `/api/parametros/` | Actualizar parámetros globales |
| GET | `/api/clientes/` | Listar clientes |
| POST | `/api/clientes/` | Crear cliente |
| PUT | `/api/clientes/{id}` | Actualizar cliente |
| DELETE | `/api/clientes/{id}` | Eliminar cliente |
| POST | `/api/upload/excel` | Ingestar archivo ERP |

---

## Frontend — App.tsx

Un solo componente raíz con `ViewState` para navegar entre módulos.

### Módulos (ViewState)
- `cover` — portada Passol con accesos rápidos
- `consulta` — búsqueda PT + tabla BOM explosion con badges fuente_costo
- `simulador` — dos modos:
  - **existente** (What-If): carga BOM, edita cantidad/costo/agrega/elimina insumos, calcula escenario
  - **nueva**: construye receta desde cero (catálogo + filas manuales libres)
- `manuales` — lista insumos sin_precio y asigna costo inline
- `clientes` — CRUD condiciones comerciales
- `parametros` — formulario de parámetros globales
- `import` — upload Excel ERP

### Estados clave del Simulador

```typescript
// Modo existente (What-If)
simInputs: { [sku]: { costo: number; cantidad: number; nombre?: string; isNew?: boolean } }
// isNew=true → fila agregada al escenario (fondo azul, badge "Nuevo")

// Modo nueva receta
nuevaInsumos: Array<{ sku, nombre, cantidad_requerida_formato, costo_unitario_clp, costo_teorico_total_clp, isManual }>
// isManual=true → fila de texto libre (sin SKU de BD)
```

---

## Design System (index.css)

```css
:root {
  --primary:       #84BD00;   /* Verde Passol */
  --primary-dark:  #6fa000;
  --primary-light: #edf7d4;
  --secondary:     #2A2B2A;   /* Topbar / textos oscuros */
  --bg:            #f8faf4;
  --surface:       #ffffff;
  --border:        #e0ecc8;
  --danger:        #dc2626;
  --warning:       #d97706;
  --success:       #16a34a;
  --font:          'DM Sans', 'Inter', system-ui, sans-serif;
}
```

### Clases utilitarias
`.card`, `.card-title`, `.tbl`, `.tbl-wrap`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`
`.badge`, `.badge-green`, `.badge-blue`, `.badge-red`, `.badge-yellow`, `.badge-gray`
`.stat-box`, `.stat-box.primary`, `.stat-box.warning`, `.stat-box.danger`, `.stat-box.success`
`.searchbar`, `.sb-input-wrap`, `.autocomplete-dropdown`, `.autocomplete-item`
`.mode-tabs`, `.mode-tab`, `.mode-tab.active`
`.edit-panel`, `.ep-title`, `.field`, `.form-grid`, `.cols-2`, `.cols-4`
`.topbar`, `.topbar-btn`, `.topbar-btn.active`, `.toolbar`
`.empty-state`, `.alert`, `.alert-success`, `.alert-error`

---

## Convenciones y reglas del proyecto

### No hacer sin confirmación
- Cambiar la arquitectura de un solo archivo (`App.tsx`) a componentes separados
- Modificar `schema.sql` directamente (usar `fix_func.sql` o scripts separados)
- Agregar dependencias npm o pip sin preguntar

### Siempre
- Verificar con `npx tsc --noEmit` después de cambios en `.tsx`
- Mantener toda la UI en `App.tsx` (decisión arquitectural intencional)
- Usar las variables CSS del design system, no colores hardcoded nuevos
- Los números monetarios se formatean con `fmt(n, decimales)` → `toLocaleString('es-CL')`

### Patrones de código
```typescript
// Fetch API estándar
const r = await fetch(`${API}/endpoint`)
if (r.ok) setData(await r.json())

// Botón de acción pequeño
<button className="btn btn-primary btn-sm" onClick={...}>Texto</button>

// Badge de estado
<span className="badge badge-green">Compra</span>
```

---

## Pendientes / Roadmap

- [x] Fila de totales al pie de la tabla del simulador existente
- [x] Comparación lado a lado: receta original vs escenario simulado
- [x] Exportar resultado de simulación a PDF o Excel
- [x] Historial de escenarios guardados (persistido en sessionStorage)
- [x] Filtro por rango de fechas en costos históricos
- [x] Indicador visual de cuántos insumos sin precio afectan el producto buscado

## Implementado en sesiones recientes

- [x] Dashboard Ejecutivo con Reporte Ejecutivo multi-hoja (ExcelJS)
- [x] App de escritorio pywebview (desktop_app.py + INICIAR.bat + build.bat)
- [x] Google Sheets sync (gspread + service account, 7 hojas)
- [x] Ley REP por formato de envase (tabla DB + CRUD + lookup en simulador)
- [x] Logos Passol en portada y topbar
- [x] `npm run build` pasa 100% sin errores TypeScript
