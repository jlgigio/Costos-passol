# Design: InfoPopover — Documentación de Metodología por Panel/Pestaña

**Fecha:** 2026-03-28
**Estado:** Aprobado
**Tipo:** Feature — UX / Documentación inline

---

## Objetivo

Agregar íconos ℹ️ junto a cada campo, stat box y resultado clave en todos los módulos
del sistema, que al hacer clic muestran un popover flotante con:
- **Título** del concepto
- **Fórmula** destacada (bloque `code`)
- **Descripción** en lenguaje mixto (comercial + técnico)

---

## Arquitectura

**Archivo modificado:** `frontend/src/App.tsx` (único archivo UI del proyecto)

### Componente `InfoPopover`

Estado global: `const [openPopover, setOpenPopover] = useState<string | null>(null)`

Cada instancia recibe un `id` único (string). Solo uno puede estar abierto a la vez.
Se cierra al hacer clic en ✕ o al abrir otro popover.

```tsx
function InfoPopover({ id, title, formula, description }: {
  id: string
  title: string
  formula: string
  description: string
}) {
  const isOpen = openPopover === id
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 4 }}>
      <button
        onClick={() => setOpenPopover(isOpen ? null : id)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--primary)', fontSize: '0.8rem', padding: '0 2px',
          lineHeight: 1, fontWeight: 700
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

---

## Puntos de inserción por módulo

### CONSULTA — Stat Boxes

| ID del popover | Junto a | Título | Fórmula | Descripción |
|---|---|---|---|---|
| `c-mp` | Costo MP | Costo Materias Primas | `SUM(cantidad × costo_unitario)` — familias MP | Suma de insumos no-packaging (MP base) de la explosión BOM recursiva. Precio tomado del último costo de compra o costo manual. |
| `c-ins` | Costo Insumos | Costo Packaging | `SUM(cantidad × costo_unitario)` — envases/tapas/etiquetas | Material de empaque del formato. Se separa de MP para análisis diferenciado. |
| `c-merma` | Merma | Merma Global | `BOM × (merma_factor − 1)` | Pérdida esperada en producción. Factor 1.025 = 2.5% extra de material. Se configura en Parámetros Globales. |
| `c-gtos` | Gastos Adic. | Gastos Adicionales | `Flete + Ley REP + Disposición + G.Indirectos` | Todos los costos sobre el BOM base. Ver desglose en la tabla de Gastos Adicionales. |
| `c-final` | Costo Final | Costo Final de Producción | `(MP + Insumos) × merma_factor + Flete + Ley REP + Disposición + G.Indirectos` | Costo completo por unidad. Base para calcular precio de lista en cada cadena. |

### CONSULTA — Tabla Gastos Adicionales (encabezados)

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `g-merma` | Merma global | `BOM × (merma_factor − 1)` | Pérdida de producción. Factor configurable en Parámetros. |
| `g-flete` | Flete | `peso_kg × costo_flete_base_kilo` | Flete genérico por peso. Las cadenas usan su flete específico en rentabilidad. |
| `g-rep` | Ley REP | `ley_rep_clp (SKU)` o `peso_kg × ley_rep_por_kilo` | Ley de Responsabilidad Extendida del Productor. SKU con valor específico tiene prioridad. |
| `g-disp` | Disposición | `peso_kg × disposicion_por_kilo` | Costo regulatorio de disposición final del producto por kilo. |
| `g-ind` | Gastos Indirectos | `costo_con_merma × gastos_indirectos_%` | Estructura y operación como % del costo base (post-merma). |

### CONSULTA — Tabla Rentabilidad por Cadena

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `r-factor` | Factor | `P.Lista = Costo Final × factor` | Multiplicador costo→precio lista. Factor 1.8 → precio = 180% del costo. |
| `r-plista` | P. Lista | `Costo Final × factor` | Precio oficial antes de descuentos. |
| `r-pfinal` | P. Final | `P.Lista × (1 − descuento_max)` | Precio neto post-descuento máximo negociado. |
| `r-mg` | Mg Final % | `(P.Final − Costo Total) / P.Final × 100` | Margen considerando producción + comisión + plan comercial. |
| `r-pc` | Plan Comercial | `(rapell + fee + marketing + x_docking + rebate + centralización) × P.Final` | Suma de todas las condiciones comerciales de la cadena. |

### SIMULADOR — Modo Existente

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `se-sim` | Total Simulado | `SUM(cantidad_editada × costo_editado) + overhead` | Costo proyectado con cambios ingresados, aplicando los mismos gastos adicionales del costo actual. |
| `se-dif` | Diferencial % | `(Simulado − Actual) / Actual × 100` | Variación entre costo actual y escenario. Rojo = encareció, Verde = abarató. |

### SIMULADOR — Modo Nueva Receta

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `sn-rep` | Ley REP est. | `peso_kg × ley_rep_por_kilo` | Estimación global. Puede diferir si el formato tiene tabla Ley REP específica. |
| `sn-flete` | Flete est. | `peso_kg × costo_flete_base_kilo` | Estimación global. El flete real por cadena puede variar. |
| `sn-ind` | G. Indirectos | `costo_total × gastos_indirectos_%` | Gastos indirectos sobre costo total de la nueva receta. |

### PARÁMETROS GLOBALES

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `p-merma` | Merma Global (factor) | `costo_con_merma = BOM × merma_factor` | Multiplicador de pérdida productiva. 1.0 = sin pérdida. 1.025 = 2.5%. Afecta TODOS los productos. |
| `p-flete` | Flete base (CLP/kg) | `flete = peso_kg × este_valor` | Costo de flete genérico. Las cadenas pueden tener flete específico en Clientes. |
| `p-rep` | Ley REP (CLP/kg) | `ley_rep = peso_kg × este_valor` (fallback) | Solo aplica cuando el SKU no tiene valor específico en la tabla Ley REP por SKU. |
| `p-disp` | Disposición (CLP/kg) | `disposicion = peso_kg × este_valor` | Costo regulatorio por kilo. Se suma directo al costo final. |
| `p-ind` | Gastos Indirectos (%) | `gtos = costo_con_merma × este_%` | % sobre el costo base post-merma. Cubre estructura, administración y operación. |
| `p-uf` | Valor UF (CLP/UF) | `ley_rep_clp = uf_por_formato × valor_uf` | Base para calcular Ley REP por formato en la tabla Ley REP. Actualizable desde Banco Central. |

### CLIENTES — Condiciones Comerciales

| ID | Junto a | Fórmula | Descripción |
|---|---|---|---|
| `cl-factor` | Factor | `P.Lista = Costo Final × factor` | Cuántas veces el costo vale el precio de lista. Factor 1.8 → precio = 180% del costo. |
| `cl-desc` | Descuento Máx. | `P.Final = P.Lista × (1 − descuento)` | Descuento máximo negociado con la cadena. |
| `cl-com` | Comisión | `comision = P.Final × comision_%` | % del precio final pagado como comisión de venta. Se suma al costo para calcular margen real. |
| `cl-pc` | Plan Comercial | `PC = (rapell + fee + marketing + x_docking + rebate + centralización) × P.Final` | Total de condiciones comerciales como % del precio final. |
| `cl-flete` | Flete Agua / Otros | `flete = peso_kg × flete_agua_kilo` o `flete_otros_kilo` | Flete diferenciado por tipo de producto (pinturas al agua vs. otros). En CLP/kg. |

---

## Criterios de implementación

- Un solo estado `openPopover: string | null` — solo uno abierto a la vez
- Cierre al hacer clic en ✕ dentro del popover
- El popover se posiciona `left: 0, top: 1.4rem` respecto al ícono (ajustar si queda fuera del viewport)
- Ícono ℹ en color `var(--primary)` (#84BD00), pequeño (0.8rem), sin borde
- No usar librerías externas — implementación CSS pura con `position: absolute`
- En tablas, el ícono va en el `<th>` junto al texto del encabezado

---

## Orden de implementación (para paralelización)

1. **Bloque A** — Componente `InfoPopover` + estado `openPopover` (base)
2. **Bloque B** — Tooltips en módulo CONSULTA (stat boxes + tabla gastos)
3. **Bloque C** — Tooltips en módulo CONSULTA (tabla rentabilidad)
4. **Bloque D** — Tooltips en módulo SIMULADOR (existente + nueva)
5. **Bloque E** — Tooltips en PARÁMETROS GLOBALES
6. **Bloque F** — Tooltips en CLIENTES (condiciones + flete)

Bloques B–F dependen de A. B y C son secuenciales (mismo módulo). D, E, F son independientes entre sí tras A.
