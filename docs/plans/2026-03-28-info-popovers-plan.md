# InfoPopover — Documentación Inline por Panel/Pestaña

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Agregar íconos ℹ️ con popover flotante junto a cada campo/resultado clave en todos los módulos del sistema, explicando la metodología de cálculo de costos en lenguaje mixto (comercial + técnico).

**Architecture:** Un único componente `InfoPopover` declarado dentro de `App()` que usa un estado compartido `openPopover: string | null` para garantizar que solo un tooltip esté abierto a la vez. Sin librerías externas. CSS puro con variables del design system.

**Tech Stack:** React 18 + TypeScript, CSS variables Passol, App.tsx único archivo (~2869 líneas)

---

## Task 1: Componente base `InfoPopover` + estado global

**Files:**
- Modify: `frontend/src/App.tsx:152-165` (dentro de `function App()`, antes del primer `useState`)

**Step 1: Agregar estado `openPopover` después de la línea 164**

Encontrar la línea:
```tsx
const [cExplosion, setCExplosion] = useState<any>(null)
```
Agregar DEBAJO de todos los `useState` existentes (buscar el último `useState` antes de las funciones `async`):
```tsx
const [openPopover, setOpenPopover] = useState<string | null>(null)
```

**Step 2: Declarar el componente `InfoPopover` dentro de `App()`**

Agregar JUSTO ANTES de `return (` (buscar la línea `return (` que inicia el JSX principal):
```tsx
function InfoPopover({ id, title, formula, description }: {
  id: string; title: string; formula: string; description: string
}) {
  const isOpen = openPopover === id
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 4 }}>
      <button
        onClick={() => setOpenPopover(isOpen ? null : id)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--primary)', fontSize: '0.8rem', padding: '0 2px',
          lineHeight: 1, fontWeight: 700, verticalAlign: 'middle'
        }}
        title="Ver metodología"
      >ℹ</button>
      {isOpen && (
        <div style={{
          position: 'absolute', zIndex: 999, width: 280, left: 0, top: '1.4rem',
          background: 'white', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: '0.75rem', textAlign: 'left'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <strong style={{ fontSize: '0.82rem', color: 'var(--secondary)' }}>{title}</strong>
            <button onClick={() => setOpenPopover(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '0.9rem', padding: 0, marginLeft: 8 }}>✕</button>
          </div>
          <code style={{
            background: '#f5f7f0', display: 'block',
            margin: '0.35rem 0', padding: '0.3rem 0.5rem',
            borderRadius: 4, fontSize: '0.76rem', color: '#2d5a00',
            wordBreak: 'break-word'
          }}>{formula}</code>
          <p style={{ fontSize: '0.8rem', color: '#555', margin: 0, lineHeight: 1.4 }}>{description}</p>
        </div>
      )}
    </span>
  )
}
```

**Step 3: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: sin errores.

---

## Task 2: Tooltips en CONSULTA — Stat Boxes

**Files:**
- Modify: `frontend/src/App.tsx:2010-2019`

**Step 1: Editar stat box "Costo MP" (línea 2010)**

Reemplazar:
```tsx
<div className="stat-box"><span className="stat-label">Costo MP</span><span className="stat-value">${fmt(cExplosion.costo_mp_clp)}</span></div>
```
Con:
```tsx
<div className="stat-box">
  <span className="stat-label">Costo MP <InfoPopover id="c-mp" title="Costo Materias Primas" formula="SUM(cantidad × costo_unitario) — familias MP" description="Suma de todos los insumos que no son packaging (MP base) de la explosión BOM recursiva. Precio tomado del último costo de compra o costo manual." /></span>
  <span className="stat-value">${fmt(cExplosion.costo_mp_clp)}</span>
</div>
```

**Step 2: Editar stat box "Costo Insumos" (línea 2011)**

Reemplazar:
```tsx
<div className="stat-box warning"><span className="stat-label">Costo Insumos</span><span className="stat-value">${fmt(cExplosion.costo_insumos_clp)}</span></div>
```
Con:
```tsx
<div className="stat-box warning">
  <span className="stat-label">Costo Insumos <InfoPopover id="c-ins" title="Costo Packaging" formula="SUM(cantidad × costo_unitario) — envases/tapas/etiquetas/cajas" description="Material de empaque del formato. Se separa de materias primas para análisis diferenciado de costos." /></span>
  <span className="stat-value">${fmt(cExplosion.costo_insumos_clp)}</span>
</div>
```

**Step 3: Editar stat box "Merma" (línea 2013-2016)**

Encontrar el bloque:
```tsx
<div className="stat-box" style={{ borderLeft: '3px solid #f59e0b' }}>
  <span className="stat-label">Merma ({((cExplosion.merma_factor - 1) * 100).toFixed(1)}%)</span>
  <span className="stat-value">${fmt((cExplosion.costo_mp_clp + cExplosion.costo_insumos_clp) * (cExplosion.merma_factor - 1))}</span>
</div>
```
Reemplazar con:
```tsx
<div className="stat-box" style={{ borderLeft: '3px solid #f59e0b' }}>
  <span className="stat-label">Merma ({((cExplosion.merma_factor - 1) * 100).toFixed(1)}%) <InfoPopover id="c-merma" title="Merma Global de Producción" formula="BOM × (merma_factor − 1)" description="Pérdida esperada en el proceso productivo. Un factor de 1.025 significa un 2.5% extra de material consumido. Se configura en Parámetros Globales." /></span>
  <span className="stat-value">${fmt((cExplosion.costo_mp_clp + cExplosion.costo_insumos_clp) * (cExplosion.merma_factor - 1))}</span>
</div>
```

**Step 4: Editar stat box "Gastos Adic." (línea 2018)**

Reemplazar:
```tsx
<div className="stat-box"><span className="stat-label">Gastos Adic.</span><span className="stat-value">${fmt(cExplosion.flete_clp + cExplosion.ley_rep_clp + cExplosion.disposicion_clp + cExplosion.gtos_indirectos_clp)}</span></div>
```
Con:
```tsx
<div className="stat-box">
  <span className="stat-label">Gastos Adic. <InfoPopover id="c-gtos" title="Gastos Adicionales" formula="Flete + Ley REP + Disposición + G.Indirectos" description="Suma de todos los costos sobre el BOM base. Ver desglose detallado en la tabla de Gastos Adicionales más abajo." /></span>
  <span className="stat-value">${fmt(cExplosion.flete_clp + cExplosion.ley_rep_clp + cExplosion.disposicion_clp + cExplosion.gtos_indirectos_clp)}</span>
</div>
```

**Step 5: Editar stat box "Costo Final" (línea 2019)**

Reemplazar:
```tsx
<div className="stat-box primary"><span className="stat-label">Costo Final</span><span className="stat-value">${fmt(cExplosion.costo_final_clp)}</span></div>
```
Con:
```tsx
<div className="stat-box primary">
  <span className="stat-label">Costo Final <InfoPopover id="c-final" title="Costo Final de Producción" formula="(MP + Insumos) × merma_factor + Flete + Ley REP + Disposición + G.Indirectos" description="Costo completo por unidad producida. Es la base para calcular el precio de lista en cada cadena de distribución." /></span>
  <span className="stat-value">${fmt(cExplosion.costo_final_clp)}</span>
</div>
```

**Step 6: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 3: Tooltips en CONSULTA — Tabla Gastos Adicionales

**Files:**
- Modify: `frontend/src/App.tsx:2060-2066` (encabezados de la tabla de gastos)

**Step 1: Agregar tooltips en headers de la tabla**

Encontrar:
```tsx
<th>Concepto</th>
<th className="num">CLP</th>
<th className="num">USD</th>
<th className="num">% s/ Costo Final</th>
```
Reemplazar con:
```tsx
<th>Concepto</th>
<th className="num">CLP</th>
<th className="num">USD</th>
<th className="num">% s/ Costo Final</th>
```
(sin cambio en headers — los tooltips van en las filas de datos)

**Step 2: Agregar tooltip en las filas de datos del desglose**

Encontrar el array `rows` dentro del IIFE de Gastos Adicionales (línea ~2052):
```tsx
const rows = [
  ...(mermaAmt > 0 ? [{ label: `Merma global (×${mermaFactor})`, clp: mermaAmt, color: '#d97706' }] : []),
  { label: 'Flete', clp: flete, color: '#555' },
  { label: 'Ley REP', clp: leyRep, color: '#555' },
  { label: 'Disposición', clp: disp, color: '#555' },
  { label: 'Gastos Indirectos', clp: gtos, color: '#555' },
]
```
Reemplazar con (agrega campo `popoverId` y `popoverProps` a cada fila):
```tsx
const rows: Array<{ label: React.ReactNode; clp: number; color: string }> = [
  ...(mermaAmt > 0 ? [{
    label: <><span>Merma global (×{mermaFactor})</span><InfoPopover id="g-merma" title="Merma Global" formula="BOM × (merma_factor − 1)" description="Pérdida de material en producción. Factor configurable en Parámetros Globales. 1.025 = 2.5% adicional sobre el costo BOM." /></>,
    clp: mermaAmt, color: '#d97706'
  }] : []),
  { label: <><span>Flete</span><InfoPopover id="g-flete" title="Costo de Flete" formula="peso_kg × costo_flete_base_kilo" description="Flete genérico por peso del formato. En rentabilidad por cadena se usa el flete específico negociado con cada cliente." /></>, clp: flete, color: '#555' },
  { label: <><span>Ley REP</span><InfoPopover id="g-rep" title="Ley REP" formula="ley_rep_clp (SKU) · o · peso_kg × ley_rep_por_kilo" description="Ley de Responsabilidad Extendida del Productor. Si el SKU tiene valor asignado en la tabla Ley REP tiene prioridad; si no, aplica el valor global por kilo." /></>, clp: leyRep, color: '#555' },
  { label: <><span>Disposición</span><InfoPopover id="g-disp" title="Costo de Disposición" formula="peso_kg × disposicion_por_kilo" description="Costo regulatorio de disposición final del producto. Se aplica por kilo producido según parámetro global." /></>, clp: disp, color: '#555' },
  { label: <><span>Gastos Indirectos</span><InfoPopover id="g-ind" title="Gastos Indirectos" formula="costo_con_merma × gastos_indirectos_%" description="Gastos de estructura y operación como porcentaje del costo base (después de aplicar merma). Se configura en Parámetros Globales." /></>, clp: gtos, color: '#555' },
]
```

**Step 3: Actualizar el render de filas** para soportar `React.ReactNode` en `label`:

Encontrar:
```tsx
<td style={{ color: r.color, fontWeight: r.color !== '#555' ? 600 : 400 }}>{r.label}</td>
```
Sin cambio — ya acepta `ReactNode`.

**Step 4: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 4: Tooltips en CONSULTA — Tabla Rentabilidad por Cadena

**Files:**
- Modify: `frontend/src/App.tsx:2838` (headers de tabla rentabilidad)

**Step 1: Localizar la tabla**

Buscar la línea que contiene:
```tsx
<th>Cliente</th><th className="num">P. Lista</th><th className="num">P. Final</th>
```

**Step 2: Reemplazar headers con tooltips**

Reemplazar la fila de `<th>` de rentabilidad con:
```tsx
<tr>
  <th>Cliente</th>
  <th className="num">P. Lista <InfoPopover id="r-plista" title="Precio de Lista" formula="Costo Final × factor" description="Precio oficial antes de descuentos. El factor es el multiplicador costo→precio negociado con la cadena." /></th>
  <th className="num">P. Final <InfoPopover id="r-pfinal" title="Precio Final" formula="P.Lista × (1 − descuento_max)" description="Precio neto después de aplicar el descuento máximo negociado con la cadena." /></th>
  <th className="num">Costo Total</th>
  <th className="num">Mg Lista % <InfoPopover id="r-mglista" title="Margen sobre Lista" formula="(P.Lista − Costo Total) / P.Lista × 100" description="Margen calculado sobre el precio de lista, antes de descuentos." /></th>
  <th className="num">Mg Final % <InfoPopover id="r-mg" title="Margen Final" formula="(P.Final − Costo Total) / P.Final × 100" description="Margen considerando todos los costos: producción + comisión + plan comercial. Es el indicador clave de rentabilidad real." /></th>
  <th className="num">Utilidad</th>
</tr>
```
> Nota: si la tabla tiene más o menos columnas, ajustar solo las que existen en el HTML real.

**Step 3: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 5: Tooltips en SIMULADOR — Modo Existente

**Files:**
- Modify: `frontend/src/App.tsx` — sección de resultados del simulador existente (buscar línea ~2669 con "Diferencial")

**Step 1: Localizar stat boxes de resultado**

Buscar:
```tsx
<span className="stat-label">Diferencial</span>
```

**Step 2: Agregar tooltips a los stat boxes de resultado del simulador**

Encontrar el bloque de stat boxes del simulador existente (donde aparecen Total Actual, Total Simulado, Diferencial). Para cada uno:

- **Total Actual:**
```tsx
<span className="stat-label">Total Actual <InfoPopover id="se-actual" title="Costo Actual BOM" formula="SUM(cantidad × costo_unitario) — BOM base" description="Costo total de la receta actual según últimos precios de compra o costos manuales, sin overhead." /></span>
```

- **Total Simulado:**
```tsx
<span className="stat-label">Total Simulado <InfoPopover id="se-sim" title="Costo Simulado" formula="SUM(cantidad_editada × costo_editado) + overhead" description="Costo proyectado aplicando los cambios ingresados en la tabla. Incluye los mismos gastos adicionales que el costo actual." /></span>
```

- **Diferencial:**
```tsx
<span className="stat-label">Diferencial <InfoPopover id="se-dif" title="Variación de Costo" formula="(Simulado − Actual) / Actual × 100" description="Variación porcentual entre el costo actual y el escenario simulado. Rojo = encareció, Verde = abarató." /></span>
```

**Step 3: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 6: Tooltips en SIMULADOR — Modo Nueva Receta

**Files:**
- Modify: `frontend/src/App.tsx` — sección stat boxes de proyección nueva (línea ~2797 con "Flete est.")

**Step 1: Localizar stat boxes de proyección**

Buscar:
```tsx
<span className="stat-label">Flete est.</span>
```

**Step 2: Agregar tooltips en stat boxes de proyección**

Encontrar los stat boxes `Ley REP est.`, `Flete est.`, `G. Indirectos`, `Costo final` en la sección de proyección de nueva receta y agregar:

- **Ley REP est.:**
```tsx
<span className="stat-label">Ley REP est. <InfoPopover id="sn-rep" title="Ley REP Estimada" formula="peso_kg × ley_rep_por_kilo" description="Estimación con parámetro global por kilo. El valor final puede diferir si el formato tiene tabla Ley REP específica asignada." /></span>
```

- **Flete est.:**
```tsx
<span className="stat-label">Flete est. <InfoPopover id="sn-flete" title="Flete Estimado" formula="peso_kg × costo_flete_base_kilo" description="Estimación de flete usando parámetro global. El flete real por cadena puede variar según condiciones negociadas." /></span>
```

- **G. Indirectos:**
```tsx
<span className="stat-label">G. Indirectos <InfoPopover id="sn-ind" title="Gastos Indirectos Estimados" formula="costo_total × gastos_indirectos_%" description="Gastos indirectos estimados sobre el costo total de la nueva receta. Porcentaje configurable en Parámetros Globales." /></span>
```

**Step 3: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 7: Tooltips en PARÁMETROS GLOBALES

**Files:**
- Modify: `frontend/src/App.tsx:1017-1022` (array de campos de parámetros)

**Step 1: Localizar el array de campos**

Encontrar (línea ~1017):
```tsx
{([
  ['Valor UF (CLP/UF)',           'valor_uf',                      1,     '$'],
  ['Disposición (CLP/kg)',        'disposicion_por_kilo',          0.1,   '$'],
  ['Gastos Indirectos (%)',       'gastos_indirectos_porcentaje',  0.001, '' ],
  ['Merma Global (factor)',       'merma_global_factor',           0.001, '' ],
] as [string, string, number, string][]).map(([label, key, step, prefix]) => (
```

**Step 2: Refactorizar para incluir tooltips**

Cambiar el array a un tipo que incluya descripción de tooltip, y renderizar el ícono en el label:

```tsx
{([
  ['Valor UF (CLP/UF)',           'valor_uf',                      1,     '$', 'p-uf',    'Valor UF',              'uf_por_formato × valor_uf = ley_rep_clp',                         'Base para calcular Ley REP por formato. Actualizable desde Banco Central en la sección Tipos de Cambio.'],
  ['Disposición (CLP/kg)',        'disposicion_por_kilo',          0.1,   '$', 'p-disp',  'Disposición por Kilo',  'disposicion = peso_kg × este_valor',                              'Costo regulatorio de disposición final del producto por kilo producido. Se suma directo al costo final.'],
  ['Gastos Indirectos (%)',       'gastos_indirectos_porcentaje',  0.001, '',  'p-ind',   'Gastos Indirectos',     'gtos = costo_con_merma × este_%',                                 'Porcentaje sobre el costo base post-merma. Cubre estructura, administración y operación general.'],
  ['Merma Global (factor)',       'merma_global_factor',           0.001, '',  'p-merma', 'Factor de Merma Global', 'costo_con_merma = BOM × merma_factor',                           'Multiplicador de pérdida productiva. 1.0 = sin pérdida. 1.025 = 2.5% extra. Afecta TODOS los productos.'],
] as [string, string, number, string, string, string, string, string][]).map(([label, key, step, prefix, pid, ptitle, pformula, pdesc]) => (
  <div className="field" key={key}>
    <label>{label} <InfoPopover id={pid} title={ptitle} formula={pformula} description={pdesc} /></label>
    ...resto igual...
  </div>
))}
```

> Nota: mantener el interior del `<div className="field">` igual (el input con prefix, step, value, onChange). Solo cambia la línea `<label>`.

**Step 3: Buscar también los campos de flete base y ley REP por kilo** que estén en otra parte del formulario de parámetros globales y agregar tooltips equivalentes:

- `costo_flete_base_kilo`: `id="p-flete"`, fórmula `flete = peso_kg × este_valor`, desc `Flete genérico por peso. Las cadenas tienen flete específico en Clientes → Flete.`
- `ley_rep_por_kilo`: `id="p-rep"`, fórmula `ley_rep = peso_kg × este_valor (fallback)`, desc `Solo aplica cuando el SKU no tiene valor en la tabla Ley REP por SKU.`
- `tipo_cambio_usd`: `id="p-usd"`, fórmula `costo_usd = costo_clp / tipo_cambio_usd`, desc `Usado para mostrar costos en USD. Actualizable desde Banco Central.`

**Step 4: Verificar TypeScript**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 8: Tooltips en CLIENTES — Condiciones Comerciales

**Files:**
- Modify: `frontend/src/App.tsx:1504-1505` (headers tabla clientes)

**Step 1: Localizar headers de tabla clientes**

Encontrar (línea ~1504):
```tsx
<th>Cliente</th><th className="ctr">Factor</th><th className="ctr">Descuento</th>
<th className="ctr">Comisión</th><th className="ctr">Plan Comercial</th>
```

**Step 2: Reemplazar con headers + tooltips**

```tsx
<tr>
  <th>Cliente</th>
  <th className="ctr">Factor <InfoPopover id="cl-factor" title="Factor de Precio" formula="P.Lista = Costo Final × factor" description="Multiplicador que convierte el costo en precio de lista. Factor 1.8 → precio = 180% del costo de producción." /></th>
  <th className="ctr">Descuento <InfoPopover id="cl-desc" title="Descuento Máximo" formula="P.Final = P.Lista × (1 − descuento)" description="Descuento máximo negociado con la cadena. Se aplica al precio de lista para obtener el precio final neto." /></th>
  <th className="ctr">Comisión <InfoPopover id="cl-com" title="Comisión de Venta" formula="comision = P.Final × comision_%" description="Porcentaje del precio final pagado como comisión de venta. Se suma al costo para calcular el margen real." /></th>
  <th className="ctr">Plan Comercial <InfoPopover id="cl-pc" title="Plan Comercial Total" formula="PC = (rapell + fee + marketing + x_docking + rebate + centralización) × P.Final" description="Suma de todas las condiciones comerciales acordadas con la cadena como porcentaje del precio final." /></th>
</tr>
```

**Step 3: Buscar también tab "Flete" en clientes** y agregar tooltip en el header:
```tsx
<InfoPopover id="cl-flete" title="Flete Diferenciado" formula="flete = peso_kg × flete_agua_kilo · o · flete_otros_kilo" description="Pinturas al agua (latex) usan flete_agua_kilo. Otros productos usan flete_otros_kilo. En CLP por kilo del formato." />
```

**Step 4: Verificar TypeScript final completo**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

---

## Notas de implementación

- Si un popover queda cortado por el borde derecho de la pantalla, ajustar `left: 0` a `right: 0` en el div del popover para que se alinee a la derecha del ícono.
- En `<th>` de tablas, usar `style={{ whiteSpace: 'nowrap' }}` si el tooltip hace que el texto del header se corte en dos líneas indeseadas.
- El componente `InfoPopover` debe declararse DENTRO de `function App()` para acceder al closure de `openPopover` y `setOpenPopover`.
- No agregar dependencias npm. No crear archivos nuevos. Todo en `App.tsx`.
