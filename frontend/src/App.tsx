import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import './index.css'

// ── ErrorBoundary ────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; error?: Error }
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'DM Sans, sans-serif', background: '#f8faf4' }}>
          <div style={{ background: '#fff', border: '1px solid #e0ecc8', borderRadius: 12, padding: '2rem 2.5rem', maxWidth: 480, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
            <h2 style={{ color: '#2A2B2A', marginBottom: '0.5rem' }}>Ocurrió un error inesperado</h2>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              {this.state.error?.message || 'Error desconocido'}
            </p>
            <button
              style={{ background: '#84BD00', color: '#fff', border: 'none', borderRadius: 8, padding: '0.6rem 1.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
              onClick={() => { this.setState({ hasError: false, error: undefined }); window.location.reload() }}>
              Recargar aplicación
            </button>
            <p style={{ color: '#aaa', fontSize: '0.78rem', marginTop: '0.75rem' }}>Detalles en: logs/app.log</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── fetchWithRetry ───────────────────────────────────────────────────────────
// Reintenta automáticamente en errores de red (no en 4xx — esos son errores del usuario)
async function fetchWithRetry(url: string, options?: RequestInit, retries = 2, delayMs = 400): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, options)
      // No reintentar errores del cliente (400-499)
      if (r.ok || (r.status >= 400 && r.status < 500)) return r
      if (attempt < retries) await new Promise(res => setTimeout(res, delayMs * (attempt + 1)))
    } catch (networkErr) {
      if (attempt < retries) await new Promise(res => setTimeout(res, delayMs * (attempt + 1)))
      else throw networkErr
    }
  }
  return fetch(url, options)
}

// ── copyToClipboard ──────────────────────────────────────────────────────────
// Funciona tanto en HTTPS como en HTTP (localhost/desktop)
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback para contextos sin permisos de clipboard (HTTP sin localhost)
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

type ViewState = 'cover' | 'import' | 'parametros' | 'clientes' | 'consulta' | 'simulador' | 'manuales' | 'productos' | 'mp' | 'dashboard' | 'alertas' | 'historial' | 'admin'

// ── Auth types ───────────────────────────────────────────────────────────────
interface UsuarioAuth {
  id: number
  email: string
  nombre: string
  es_admin: boolean
  permisos: Record<string, boolean>
}


// ── fetchWithAuth ─────────────────────────────────────────────────────────────
function fetchWithAuth(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = sessionStorage.getItem('passol_token') || ''
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> || {}),
    },
  })
}

interface Cliente {
  id?: number
  cliente: string
  factor: number
  descuento_max: number
  comision_promedio: number
  rapell: number
  fee: number
  marketing: number
  x_docking: number
  rebate: number
  rebate_centralizacion: number
  flete_por_kilo: number
  flete_agua_kilo: number
  flete_otros_kilo: number
  pallet_agua_kilo: number
  pallet_otros_kilo: number
}

interface Parametros {
  id?: number
  ley_rep_por_kilo: number
  disposicion_por_kilo: number
  gastos_indirectos_porcentaje: number
  comision_porcentaje: number
  merma_global_factor: number
  costo_flete_base_kilo: number
  costo_pallet_base_kilo: number
  tipo_cambio_usd: number
  tipo_cambio_eur: number
  valor_uf: number
}

interface LeyRepFormato {
  id?: number
  formato: string
  uf_por_formato: number
}

const API = ''  // Vite proxy redirige /api → http://localhost:8001

// Debounce utility — module-level timers, safe to call from async event handlers
const _dTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const debounceCall = (key: string, fn: () => void, delay = 250) => {
  clearTimeout(_dTimers[key])
  _dTimers[key] = setTimeout(fn, delay)
}
const fmt = (n: number, d = 0) => n?.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (n: number) => (n * 100).toFixed(1) + '%'
const fmtCLP = (n: number, d = 0) => `$${fmt(n, d)}`
const fmtUSD = (n: number, d = 2) => `USD ${fmt(n, d)}`

const FAMILIAS_PACKAGING_SET = new Set(['ENVASES','TAPAS','CAJAS','ETIQUETAS','OTROS INSUMOS ENVASADO','PALLET','COMPLEMENTOS PINTURAS'])

function TablaInsumos({ insumos }: { insumos: any[] }) {
  const mp     = insumos.filter(r => !FAMILIAS_PACKAGING_SET.has((r.familia || '').toUpperCase()))
  const envase = insumos.filter(r =>  FAMILIAS_PACKAGING_SET.has((r.familia || '').toUpperCase()))
  const subtotalEnvase    = envase.reduce((s, r) => s + r.costo_teorico_total_clp, 0)
  const subtotalEnvaseUsd = envase.reduce((s, r) => s + (r.costo_teorico_total_usd || 0), 0)

  // Agrupar MP por sub-receta de nivel 1
  const subrecetasMap = new Map<string, { nombre: string; items: any[] }>()
  for (const r of mp) {
    const key = r.subreceta_sku || '__directo__'
    const label = r.subreceta_nombre || 'Insumos directos'
    if (!subrecetasMap.has(key)) subrecetasMap.set(key, { nombre: label, items: [] })
    subrecetasMap.get(key)!.items.push(r)
  }

  const renderRow = (row: any, i: number) => {
    const noPrice = row.costo_unitario_clp_actual === 0
    return (
      <tr key={`${row.insumo_final}-${i}`} style={noPrice ? { background: '#fffbeb' } : {}}>
        <td><span className="fw-600 text-xs" style={{ color: 'var(--primary)', cursor: 'copy' }} title="Copiar SKU" onClick={() => copyToClipboard(row.insumo_final)}>{row.insumo_final}</span></td>
        <td>
          {row.nombre_insumo}
          {noPrice && <span className="badge badge-yellow" style={{ marginLeft: 6 }}>⚠ Sin precio</span>}
        </td>
        <td className="num">{fmt(row.cantidad_requerida_formato, 4)}</td>
        <td className="num" style={noPrice ? { color: 'var(--warning)' } : {}}>${fmt(row.costo_unitario_clp_actual, 2)}</td>
        <td className="num" style={{ color: noPrice ? 'var(--warning)' : 'inherit' }}>
          {noPrice ? '—' : fmtUSD(row.costo_unitario_usd_actual || 0, 4)}
        </td>
        <td className="ctr">
          {row.fuente_costo === 'compra'     && <span className="badge badge-green">Compra</span>}
          {row.fuente_costo === 'manual'     && <span className="badge badge-blue">Manual</span>}
          {row.fuente_costo === 'sin_precio' && <span className="badge badge-red">—</span>}
        </td>
        <td className="num fw-600" style={{ color: noPrice ? 'var(--warning)' : 'var(--primary)' }}>
          ${fmt(row.costo_teorico_total_clp, 2)}
        </td>
        <td className="num fw-600" style={{ color: noPrice ? 'var(--warning)' : '#2563eb' }}>
          {noPrice ? '—' : fmtUSD(row.costo_teorico_total_usd || 0, 2)}
        </td>
      </tr>
    )
  }

  const seccionHeader = (label: string, sub = false) => (
    <tr>
      <td colSpan={8} style={{
        background: sub ? '#f0f7e6' : 'var(--bg)',
        padding: sub ? '3px 16px' : '3px 8px',
        fontSize: sub ? '0.66rem' : '0.68rem',
        fontWeight: 700,
        color: sub ? 'var(--primary-dark)' : 'var(--secondary)',
        letterSpacing: '0.06em',
        borderTop: '1px solid var(--border)',
      }}>
        {sub ? `↳ ${label}` : label}
      </td>
    </tr>
  )

  const subtotalRow = (label: string, valor: number, valorUsd: number, color: string, bg: string, indent = false) => (
    <tr style={{ background: bg }}>
      <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.73rem', padding: indent ? '3px 16px' : '3px 8px', color: 'var(--secondary)', borderTop: '1px solid var(--border)' }}>{label}</td>
      <td className="num fw-700" style={{ color, fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>${fmt(valor, 2)}</td>
      <td className="num fw-700" style={{ color: 'var(--info)', fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>{fmtUSD(valorUsd, 2)}</td>
    </tr>
  )

  const totalMP    = mp.reduce((s, r) => s + r.costo_teorico_total_clp, 0)
  const totalMPUsd = mp.reduce((s, r) => s + (r.costo_teorico_total_usd || 0), 0)

  return (
    <>
      {subrecetasMap.size > 0 && (
        <>
          {seccionHeader('MATERIAS PRIMAS')}
          {Array.from(subrecetasMap.entries()).map(([key, { nombre, items }]) => {
            const subtotal    = items.reduce((s, r) => s + r.costo_teorico_total_clp, 0)
            const subtotalUsd = items.reduce((s, r) => s + (r.costo_teorico_total_usd || 0), 0)
            const showSubHeader = subrecetasMap.size > 1 || key !== '__directo__'
            return (
              <React.Fragment key={key}>
                {showSubHeader && seccionHeader(nombre, true)}
                {items.map(renderRow)}
                {showSubHeader && subtotalRow(`Subtotal ${nombre.replace(' (PROCESO)', '').slice(0, 40)}`, subtotal, subtotalUsd, 'var(--primary)', 'var(--primary-light)', true)}
              </React.Fragment>
            )
          })}
          {subrecetasMap.size > 1 && subtotalRow('TOTAL MATERIAS PRIMAS', totalMP, totalMPUsd, 'var(--primary-dark)', '#d4edac')}
        </>
      )}
      {envase.length > 0 && (
        <>
          {seccionHeader('INSUMOS / PACKAGING')}
          {envase.map(renderRow)}
          {subtotalRow('Subtotal Insumos / Packaging', subtotalEnvase, subtotalEnvaseUsd, 'var(--warning)', '#fef9ec')}
        </>
      )}
    </>
  )
}

// ── Toast system ────────────────────────────────────────────────────────────
type Toast = { id: number; type: 'success' | 'error' | 'info' | 'warning'; msg: string }
let _toastId = 0
const toastIcons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' }

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{toastIcons[t.type]}</span>
          <span className="toast-msg">{t.msg}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Skeleton Loaders ────────────────────────────────────────────────────────
function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ['sk-mid', 'sk-wide', 'sk-short', 'sk-mid', 'sk-wide', 'sk-short', 'sk-mid']
  return (
    <tbody className="sk-tbody">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}><span className={`sk sk-line ${widths[(r + c) % widths.length]}`} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem' }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ flex: '1 1 160px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
          <span className="sk sk-line sk-short sk-sm" style={{ marginBottom: 10, display: 'block' }} />
          <span className="sk sk-line sk-lg" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  )
}

function SkeletonForm({ fields = 6 }: { fields?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', padding: '1.25rem' }}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <span className="sk sk-line sk-short sk-sm" style={{ marginBottom: 8, display: 'block', width: '45%' }} />
          <span className="sk sk-line" style={{ height: 34, borderRadius: 6 }} />
        </div>
      ))}
    </div>
  )
}

// ── Confirm Dialog ──────────────────────────────────────────────────────────
type ConfirmOpts = { msg: string; danger?: boolean; onYes: () => void }
function ConfirmDialog({ opts, onClose }: { opts: ConfirmOpts; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1.5rem 1.75rem', maxWidth: 400, width: '90%', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '0.95rem', color: 'var(--secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>{opts.msg}</div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => { opts.onYes(); onClose() }}>Confirmar</button>
        </div>
      </div>
    </div>
  )
}

// ── Autocomplete keyboard nav hook ──────────────────────────────────────────
function useAcNav() {
  const [idx, setIdx] = React.useState(-1)
  // Call with length + onEnter so it can handle Enter key and bounds
  const onKeyDown = (e: React.KeyboardEvent, length: number, onEnter?: () => void) => {
    if (length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => i < length - 1 ? i + 1 : i) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => i > 0 ? i - 1 : 0) }
    else if (e.key === 'Enter' && idx >= 0 && onEnter) { e.preventDefault(); onEnter(); setIdx(-1) }
  }
  return { idx, onKeyDown, reset: () => setIdx(-1) }
}

function App() {
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [usuario, setUsuario] = useState<UsuarioAuth | null>(() => {
    try {
      const s = sessionStorage.getItem('passol_user')
      return s ? JSON.parse(s) : null
    } catch { return null }
  })
  const [loginEmail, setLoginEmail]       = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError]       = useState('')
  const [loginLoading, setLoginLoading]   = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(''); setLoginLoading(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      })
      const data = await r.json()
      if (!r.ok) { setLoginError(data.detail || 'Error al iniciar sesión.'); return }
      sessionStorage.setItem('passol_token', data.token)
      sessionStorage.setItem('passol_user', JSON.stringify(data.usuario))
      setUsuario(data.usuario)
    } catch {
      setLoginError('No se pudo conectar con el servidor. Verifica que la aplicación esté corriendo.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem('passol_token')
    sessionStorage.removeItem('passol_user')
    sessionStorage.removeItem('passol_view')
    setUsuario(null)
    setLoginEmail(''); setLoginPassword(''); setLoginError('')
  }

  const canAccess = (mod: string) => {
    if (!usuario) return false
    if (usuario.es_admin) return true
    return !!usuario.permisos[mod]
  }

  // ── View state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewState>(() => {
    const saved = sessionStorage.getItem('passol_view') as ViewState | null
    return saved || 'cover'
  })

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = (msg: string, type: Toast['type'] = 'success', duration = 3500) => {
    const id = ++_toastId
    setToasts(prev => [...prev, { id, type, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))


  // Autocomplete keyboard nav — one hook per search box
  const acConsulta  = useAcNav()
  const acSim       = useAcNav()
  const acSimAdd    = useAcNav()
  const acRent      = useAcNav()
  const acSr        = useAcNav()
  const acCad       = useAcNav()
  const acProd      = useAcNav()
  const acIns       = useAcNav()
  const acInsumos   = useAcNav() // nueva receta
  const acBase      = useAcNav() // costo base

  // Simulador — búsqueda y explosión propias
  const [skuSim, setSkuSim] = useState('')
  const [simSearch, setSimSearch] = useState('')
  const [simSug, setSimSug] = useState<any[]>([])
  const [explosion, setExplosion] = useState<any>(null)
  const [simResult, setSimResult] = useState<any>(null)
  const [simNuevaResult, setSimNuevaResult] = useState<any>(null)
  // Consulta — búsqueda y explosión propias (independiente del simulador)
  const [cSearch, setCSearch] = useState('')
  const [cSug, setCSug] = useState<any[]>([])
  const [cExplosion, setCExplosion] = useState<any>(null)
  const [cSku, setCSku] = useState('')
  const [cNombre, setCNombre] = useState('')
  const [pvMargen,     setPvMargen]     = useState('')
  const [pvAjuste,     setPvAjuste]     = useState('')
  const [pvAjusteSign, setPvAjusteSign] = useState<'+' | '-'>('+')
  const [pvSaveMsg,    setPvSaveMsg]    = useState('')
  const [pvSaving,     setPvSaving]     = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadRecalculo, setUploadRecalculo] = useState<{ skus_afectados: number; filas_eliminadas: number } | null>(null)
  const [recalculoLoading, setRecalculoLoading] = useState(false)
  const [recalculoResult, setRecalculoResult] = useState<{ skus_afectados: number; filas_eliminadas: number; message: string } | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [editCliente, setEditCliente] = useState<Cliente | null>(null)
  const [formStrs, setFormStrs] = useState<Record<string, string>>({})

  const _condNumFields = ['factor','descuento_max','comision_promedio','rapell','fee','marketing','x_docking','rebate','rebate_centralizacion','flete_agua_kilo','flete_otros_kilo','pallet_agua_kilo','pallet_otros_kilo']
  const clienteToStrs = (c: any): Record<string, string> => {
    const s: Record<string, string> = {}
    for (const k of _condNumFields) { const v = c?.[k]; s[k] = (v != null && v !== 0) ? String(v) : '' }
    return s
  }
  const [params, setParams] = useState<Parametros | null>(null)
  const [editParams, setEditParams] = useState<Parametros | null>(null)
  const [tcFetching, setTcFetching] = useState(false)
  const [tcFetched, setTcFetched] = useState<{ usd: number; eur: number; fecha: string } | null>(null)
  const [simInputs, setSimInputs] = useState<{ [k: string]: { costo: number; cantidad: number; nombre?: string; isNew?: boolean; subreceta_sku?: string; subreceta_nombre?: string; familia?: string } }>({})
  const [sinPrecio, setSinPrecio] = useState<any[]>([])
  const [manualSku, setManualSku] = useState('')
  const [manualCosto, setManualCosto] = useState('')
  const [manualNota, setManualNota] = useState('')
  const [manualMsg, setManualMsg] = useState('')
  const [simMode, setSimMode] = useState<'existente' | 'nueva'>('existente')
  const [simBomFilter, setSimBomFilter] = useState('')
  // ── Modo Precio desde Costo Base ──
  const [baseSearch, setBaseSearch]       = useState('')
  const [baseSug, setBaseSug]             = useState<any[]>([])
  const [baseSku, setBaseSku]             = useState('')
  const [_baseNombre, setBaseNombre]       = useState('')
  const [baseCosto, setBaseCosto]         = useState('')
  const [baseLoading, setBaseLoading]     = useState(false)
  const [baseResult, setBaseResult]       = useState<any>(null)
  const [baseParams, setBaseParams]       = useState<{
    merma_factor: string; flete_base_kilo: string; pallet_base_kilo: string;
    ley_rep_clp: string; disposicion_kilo: string; gastos_indirectos: string
  } | null>(null)
  const [baseExpandRow, setBaseExpandRow] = useState<number | null>(null)
  const [nuevaConfig, setNuevaConfig] = useState({ peso_kilos: 1.0 })
  const [nuevaFormato, setNuevaFormato] = useState('')
  const [nuevaNombre, setNuevaNombre] = useState('')
  const [nuevaUnidad, setNuevaUnidad] = useState<'kg' | 'litro' | 'galon' | 'unidad'>('kg')
  const [nuevaDensidad, setNuevaDensidad] = useState('')
  const [nuevaMermaFactor, setNuevaMermaFactor] = useState('')
  const [formatosList, _setFormatosList] = useState<string[]>([
    '1/4 GALÓN','BALDE','BIDÓN','BOTELLA','CAJA','GALÓN','IBC',
    'KIT 1 GALÓN','KIT 2 GALONES','KIT TINETA 4 GAL','KILOGRAMOS',
    'LATA','LITROS','POTE','SACO','TAMBOR','TINETA','UNIDAD'
  ])
  const [nuevaInsumos, setNuevaInsumos] = useState<any[]>([])
  const [searchInsumo, setSearchInsumo] = useState('')
  const [insumosSug, setInsumosSug] = useState<any[]>([])
  const [simAddSearch, setSimAddSearch] = useState('')
  const [simAddSug, setSimAddSug] = useState<any[]>([])
  // Simulador — ítems de texto libre (sin SKU en BD)
  const simLibreCounter = useRef(0)
  const [simLibreItems, setSimLibreItems] = useState<
    { id: string; nombre: string; cantidad: number; costo: number; costoUsd: number }[]
  >([])
  const [simLibreNombre, setSimLibreNombre] = useState('')
  const [simLibreCantidad, setSimLibreCantidad] = useState<number>(0)
  const [simLibreCosto, setSimLibreCosto] = useState<number>(0)
  const [simLibreCostoUsd, setSimLibreCostoUsd] = useState<number>(0)
  const [simLibreOpen, setSimLibreOpen] = useState(false)
  // Consulta masiva
  const [consultaMode, setConsultaMode] = useState<'sku' | 'masivo' | 'cadenas' | 'base'>('sku')
  const [masivFamilias, setMasivFamilias] = useState<string[]>([])
  const [masivSubfamilias, setMasivSubfamilias] = useState<string[]>([])
  const [masivFamilia, setMasivFamilia] = useState('')
  const [masivSubfamilia, setMasivSubfamilia] = useState('')
  const [masivSearch, setMasivSearch] = useState('')
  const [masivResultados, setMasivResultados] = useState<any[]>([])
  const [masivLoading, setMasivLoading] = useState(false)
  const [masivPage, setMasivPage] = useState(1)
  const MASIV_PAGE_SIZE = 100
  const [masivExplosion, setMasivExplosion] = useState<{ sku: string; nombre: string; data: any } | null>(null)
  const [masivPvMargen,      setMasivPvMargen]      = useState('')
  const [masivPvAjuste,      setMasivPvAjuste]      = useState('')
  const [masivPvAjusteSign,  setMasivPvAjusteSign]  = useState<'+' | '-'>('+')
  const [masivPvSaveMsg,     setMasivPvSaveMsg]     = useState('')
  const [masivPvSaving,      setMasivPvSaving]      = useState(false)
  // PV por producto en drill-down masivo
  const [masivSkuPvMargen,     setMasivSkuPvMargen]     = useState('')
  const [masivSkuPvAjuste,     setMasivSkuPvAjuste]     = useState('')
  const [masivSkuPvAjusteSign, setMasivSkuPvAjusteSign] = useState<'+' | '-'>('+')
  const [masivSkuPvSaveMsg,    setMasivSkuPvSaveMsg]    = useState('')
  const [masivSkuPvSaving,     setMasivSkuPvSaving]     = useState(false)
  // Costos por Cadena
  const [cadenaMode, setCadenaMode]               = useState<'sku' | 'masivo'>('sku')
  // sub-modo SKU
  const [cadSkuSearch, setCadSkuSearch]           = useState('')
  const [cadSkuSug, setCadSkuSug]                 = useState<any[]>([])
  const [cadSku, setCadSku]                       = useState('')
  const [cadSkuNombre, setCadSkuNombre]           = useState('')
  const [cadExplosion, setCadExplosion]           = useState<any>(null)
  const [cadSkuLoading, setCadSkuLoading]         = useState(false)
  const [cadExpandida, setCadExpandida]           = useState<string | null>(null)
  // sub-modo Masiva
  const [cadMasivClienteId, setCadMasivClienteId] = useState<number>(0)
  const [cadMasivFamilia, setCadMasivFamilia]     = useState('')
  const [cadMasivSubfamilia, setCadMasivSubfamilia] = useState('')
  const [cadMasivSubfamilias, setCadMasivSubfamilias] = useState<string[]>([])
  const [cadMasivSearch, setCadMasivSearch]       = useState('')
  const [cadMasivResultados, setCadMasivResultados] = useState<any[]>([])
  const [cadMasivLoading, setCadMasivLoading]     = useState(false)
  // PV — Por SKU cadenas
  const [cadSkuPvMargen,     setCadSkuPvMargen]     = useState('')
  const [cadSkuPvAjuste,     setCadSkuPvAjuste]     = useState('')
  const [cadSkuPvAjusteSign, setCadSkuPvAjusteSign] = useState<'+' | '-'>('+')
  const [cadSkuPvSaveMsg,    setCadSkuPvSaveMsg]    = useState('')
  const [cadSkuPvSaving,     setCadSkuPvSaving]     = useState(false)
  // PV — Masiva cadenas (panel global)
  const [cadMasivPvMargen,     setCadMasivPvMargen]     = useState('')
  const [cadMasivPvAjuste,     setCadMasivPvAjuste]     = useState('')
  const [cadMasivPvAjusteSign, setCadMasivPvAjusteSign] = useState<'+' | '-'>('+')
  const [cadMasivPvSaveMsg,    setCadMasivPvSaveMsg]    = useState('')
  const [cadMasivPvSaving,     setCadMasivPvSaving]     = useState(false)
  // Drill-down por producto en masiva cadenas
  const [cadMasivExplosion,        setCadMasivExplosion]        = useState<{ sku: string; nombre: string; data: any } | null>(null)
  const [cadMasivSkuPvMargen,      setCadMasivSkuPvMargen]      = useState('')
  const [cadMasivSkuPvAjuste,      setCadMasivSkuPvAjuste]      = useState('')
  const [cadMasivSkuPvAjusteSign,  setCadMasivSkuPvAjusteSign]  = useState<'+' | '-'>('+')
  const [cadMasivSkuPvSaveMsg,     setCadMasivSkuPvSaveMsg]     = useState('')
  const [cadMasivSkuPvSaving,      setCadMasivSkuPvSaving]      = useState(false)
  const [leyRepList, setLeyRepList] = useState<LeyRepFormato[]>([])
  const [leyRepEdit, setLeyRepEdit] = useState<LeyRepFormato | null>(null)
  const [leyRepNew, setLeyRepNew] = useState<LeyRepFormato>({ formato: '', uf_por_formato: 0 })
  const [leyRepAddOpen, setLeyRepAddOpen] = useState(false)
  const [paramTab, setParamTab] = useState<'globales' | 'ley-rep' | 'costos-manuales'>('globales')
  type InsumoConCosto = { sku: string; nombre: string; unidad_medida: string; densidad: number; tipo_cambio_usd: number; costo_actual_clp: number; fuente_costo: string; costo_manual_clp: number | null; costo_compra_clp: number | null; fecha_manual: string | null }
  const [cmSearch, setCmSearch] = useState('')
  const [cmResultados, setCmResultados] = useState<InsumoConCosto[]>([])
  const [cmSeleccionado, setCmSeleccionado] = useState<InsumoConCosto | null>(null)
  const [cmPrecioCot, setCmPrecioCot] = useState('')
  const [cmMoneda, setCmMoneda] = useState<'CLP' | 'USD'>('CLP')
  const [cmUnidad, setCmUnidad] = useState<'Lt' | 'Kg'>('Lt')
  const [cmDensidad, setCmDensidad] = useState('')
  const [cmOverrides, setCmOverrides] = useState<any[]>([])
  const [cmSugOpen, setCmSugOpen] = useState(false)
  const [cmInlineEditSku, setCmInlineEditSku] = useState<string | null>(null)
  const [cmInlineEditVal, setCmInlineEditVal] = useState('')
  const [cmInlineMoneda, setCmInlineMoneda] = useState<'CLP' | 'USD'>('CLP')
  const [cmInlineUnidad, setCmInlineUnidad] = useState<'Lt' | 'Kg'>('Kg')
  const [cmInlineDensidad, setCmInlineDensidad] = useState('')
  type CostoIndirectoRow = { id: number; cliente: string; flete_agua_kilo: number; flete_otros_kilo: number; pallet_agua_kilo: number; pallet_otros_kilo: number }
  const [costoIndirectos, setCostoIndirectos] = useState<CostoIndirectoRow[]>([])
  const [nuevoClienteNombre, setNuevoClienteNombre] = useState('')
  const [addClienteOpen, setAddClienteOpen] = useState(false)
  const [cadenasTab, setCadenasTab] = useState<'condiciones' | 'flete' | 'pallet' | 'rentabilidad' | 'sim-rent'>('condiciones')
  const [rentSearch, setRentSearch] = useState('')
  const [rentSug, setRentSug] = useState<any[]>([])
  const [rentData, setRentData] = useState<any>(null)
  const [rentLoading, setRentLoading] = useState(false)
  const [rentInfoOpen, setRentInfoOpen] = useState(false)
  // Simulador de Rentabilidad
  const [srSearch, setSrSearch] = useState('')
  const [srSug, setSrSug] = useState<any[]>([])
  const [srData, setSrData] = useState<any>(null)
  const [srLoading, setSrLoading] = useState(false)
  const [srSelected, setSrSelected] = useState<any>(null)
  const [srInputs, setSrInputs] = useState<any>({})
  const [srResult, setSrResult] = useState<any>(null)
  const [srCalcLoading, setSrCalcLoading] = useState(false)
  const [srScenName, setSrScenName] = useState('')
  const [srScenarios, setSrScenarios] = useState<any[]>([])
  const [srConfirm, setSrConfirm] = useState(false)
  const [srSaveMsg, setSrSaveMsg] = useState('')
  // Simulador Masivo (por familia)
  const [srMode,              setSrMode]              = useState<'sku'|'masivo'>('sku')
  const [srMasivFamilia,      setSrMasivFamilia]      = useState('')
  const [srMasivSubfamilia,   setSrMasivSubfamilia]   = useState('')
  const [srMasivSubfamilias,  setSrMasivSubfamilias]  = useState<string[]>([])
  const [srMasivCadenaId,     setSrMasivCadenaId]     = useState<number>(0)
  const [srMasivInputs,       setSrMasivInputs]       = useState<any>({})
  const [srMasivInputsOrig,   setSrMasivInputsOrig]   = useState<any>({})
  const [srMasivInputsLoaded, setSrMasivInputsLoaded] = useState(false)
  const [srMasivStrs,         setSrMasivStrs]         = useState<Record<string,string>>({})
  const [srMasivResultados,   setSrMasivResultados]   = useState<any[]>([])
  const [srMasivLoading,      setSrMasivLoading]      = useState(false)

  // ── Módulo Productos ──────────────────────────────────────────
  const [prodTab, setProdTab]             = useState<'ficha' | 'historial'>('ficha')
  const [prodSearch, setProdSearch]       = useState('')
  const [prodSug, setProdSug]             = useState<any[]>([])
  const [prodSku, setProdSku]             = useState('')
  const [prodNombre, setProdNombre]       = useState('')
  const [_prodFicha, setProdFicha]         = useState<any>(null)
  const [prodHistorial, setProdHistorial] = useState<any[]>([])
  const [prodLoading, setProdLoading]     = useState(false)
  const [prodSaving, setProdSaving]       = useState(false)
  const [prodSaveMsg, setProdSaveMsg]     = useState('')
  const [prodEdit, setProdEdit]           = useState<any>({})
  const [_prodModulo, _setProdModulo]       = useState<'pt' | 'insumos'>('pt')
  // Módulo Insumos (pestaña dentro de Productos)
  const [insSearch, setInsSearch]         = useState('')
  const [insSug, setInsSug]               = useState<any[]>([])
  const [insSku, setInsSku]               = useState('')
  const [insNombre, setInsNombre]         = useState('')
  const [insHistorial, setInsHistorial]   = useState<any[]>([])
  const [insLoading, setInsLoading]       = useState(false)
  const [insFechaDesde, setInsFechaDesde] = useState('')
  const [insFechaHasta, setInsFechaHasta] = useState('')
  type LeyRepProducto = { sku: string; nombre: string; formato: string; ley_rep_clp: number | null }
  const [leyRepProductos, setLeyRepProductos] = useState<LeyRepProducto[]>([])
  const [leyRepFiltro, setLeyRepFiltro] = useState('')
  const [leyRepBusqueda, setLeyRepBusqueda] = useState('')
  const [leyRepEditCLP, setLeyRepEditCLP] = useState<{ [sku: string]: string }>({})

  // ── Dashboard Ejecutivo ──────────────────────────────────────────────────
  const [dashData, setDashData]       = useState<any[]>([])
  const [dashLoading, setDashLoading] = useState(false)
  const [dashFamilia, setDashFamilia] = useState('')
  const [dashEstado, setDashEstado]   = useState('')   // '' | 'completo' | 'incompleto' | 'sin_bom'
  const [dashSearch, setDashSearch]   = useState('')
  const [dashSort, setDashSort]       = useState<{ col: string; dir: 1 | -1 }>({ col: 'estado', dir: 1 })
  const [dashPage, setDashPage]       = useState(1)
  const DASH_PAGE_SIZE = 100

  // ── Historial de Escenarios ──────────────────────────────────────────────
  const [historial, setHistorial]         = useState<any[]>([])
  const [historialLoading, setHistorialLoading] = useState(false)
  const [histFechaDesde, setHistFechaDesde] = useState('')
  const [histFechaHasta, setHistFechaHasta] = useState('')
  const [escNombre, setEscNombre]         = useState('')
  const [escSaving, setEscSaving]         = useState(false)
  const [escSaveMsg, setEscSaveMsg]       = useState('')
  const [simCompareOpen, setSimCompareOpen] = useState(false)

  // ── Alertas de variación ─────────────────────────────────────────────────
  const [alertas, setAlertas]         = useState<any[]>([])
  const [alertasLoading, setAlertasLoading] = useState(false)
  const [alertasUmbral, setAlertasUmbral]   = useState('5')

  // ── Consulta Materias Primas (read-only) ────────────────────────────────
  const [mpList, setMpList]         = useState<any[]>([])
  const [mpLoading, setMpLoading]   = useState(false)
  const [mpSearch, setMpSearch]     = useState('')
  const [mpTipo, setMpTipo]         = useState('')       // '' | 'Insumo' | 'Sub-receta'
  const [mpFuente, setMpFuente]     = useState('')       // '' | 'compra' | 'manual' | 'sin_precio'

  const [openPopover, setOpenPopover] = useState<string | null>(null)
  const [popoverPos, setPopoverPos] = useState<{top: number, left: number}>({top: 0, left: 0})
  const [popoverContent, setPopoverContent] = useState<{title: string, formula: string, description: string} | null>(null)

  useEffect(() => {
    if (view === 'clientes') loadClientes()
    if (view === 'consulta' && clientes.length === 0) loadClientes()
    if (view === 'parametros') { loadParams(); loadLeyRepFormatos(); loadCostoIndirectos(); loadLeyRepProductos(); loadCmOverrides() }
    if (view === 'manuales') loadSinPrecio()
    if (view === 'mp') loadMpList()
    if (view === 'dashboard') loadDashboard()
    if (view === 'alertas') loadAlertas()
    if (view === 'historial') loadHistorial()
  }, [view])

  // ESC cierra todos los dropdowns/autocompletes abiertos
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setCSug([])
      setBaseSug([])
      setInsumosSug([])
      setRentSug([])
      setSrSug([])
      setCadSkuSug([])
      setSimSug([])
      setSimAddSug([])
      setProdSug([])
      setInsSug([])
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const [confirmDlg, setConfirmDlg] = useState<ConfirmOpts | null>(null)
  const confirmAction = (msg: string, onYes: () => void, danger = true) => setConfirmDlg({ msg, onYes, danger })

  const go = (v: ViewState) => { setView(v); sessionStorage.setItem('passol_view', v) }

  /* ---- Exportación Excel ---- */
  const exportToExcel = (sheets: { name: string; data: Record<string, any>[] }[], fileName: string) => {
    const wb = XLSX.utils.book_new()
    for (const sheet of sheets) {
      const data = sheet.data.length > 0 ? sheet.data : [{ 'Sin datos': '' }]
      const ws = XLSX.utils.json_to_sheet(data)
      const headers = Object.keys(data[0])

      // Auto-width columns
      const cols = headers.map(k => {
        const maxLen = Math.max(k.length, ...data.map(r => String(r[k] ?? '').length))
        return { wch: Math.min(maxLen + 2, 40) }
      })
      ws['!cols'] = cols

      // Formato moneda por nombre de columna
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      for (let C = range.s.c; C <= range.e.c; C++) {
        const hCell = ws[XLSX.utils.encode_cell({ r: 0, c: C })]
        const h = String(hCell?.v || '')
        const fmt = /CLP/i.test(h) ? '"$"#,##0.00'
                  : /USD/i.test(h) ? '"USD "#,##0.00'
                  : /EUR/i.test(h) ? '"EUR "#,##0.00'
                  : null
        if (!fmt) continue
        for (let R = 1; R <= range.e.r; R++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C })
          if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = fmt
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31))
    }
    XLSX.writeFile(wb, fileName)
  }

  /* ---- Export BOM con ExcelJS (Resumen + Receta Completa con estilos) ---- */
  const exportBomToExcel = async (sku: string, nombre: string, d: any) => {
    const tc       = d.tipo_cambio_usd || 950
    const bom      = (d.costo_mp_clp || 0) + (d.costo_insumos_clp || 0)
    const mermaAmt = bom * ((d.merma_factor || 1) - 1)
    const isPackaging = (ins: any) => FAMILIAS_PACKAGING_SET.has((ins.familia || '').toUpperCase())
    const insumos: any[] = d.detalle_insumos || []
    const mpRows  = insumos.filter(i => !isPackaging(i))
    const pkgRows = insumos.filter(i =>  isPackaging(i))
    const gastosItems = [
      { label: `Merma (×${d.merma_factor})`, clp: mermaAmt },
      { label: 'Flete base',         clp: d.flete_clp       || 0 },
      { label: 'Pallet base',        clp: d.pallet_clp      || 0 },
      { label: 'Ley REP',            clp: d.ley_rep_clp     || 0 },
      { label: 'Disposición',        clp: d.disposicion_clp || 0 },
      { label: 'Gastos Indirectos',  clp: d.gtos_indirectos_clp || 0 },
    ].filter(g => g.clp > 0)

    const wb = new ExcelJS.Workbook()
    const fmtCLPx = '"$"#,##0.00'
    const fmtUSDx = '"USD "#,##0.00'

    // ── Hoja 1: Resumen ──
    const ws1 = wb.addWorksheet('Resumen')
    ws1.columns = [
      { header: 'SKU',                   key: 'sku',      width: 18 },
      { header: 'Nombre',                key: 'nombre',   width: 40 },
      { header: 'Costo MP CLP',          key: 'mp',       width: 16, style: { numFmt: fmtCLPx } },
      { header: 'Costo Insumos CLP',     key: 'ins',      width: 18, style: { numFmt: fmtCLPx } },
      { header: 'Merma Factor',          key: 'mermaF',   width: 14 },
      { header: 'Merma CLP',             key: 'mermaC',   width: 14, style: { numFmt: fmtCLPx } },
      { header: 'Flete CLP',             key: 'flete',    width: 13, style: { numFmt: fmtCLPx } },
      { header: 'Pallet CLP',            key: 'pallet',   width: 13, style: { numFmt: fmtCLPx } },
      { header: 'Ley REP CLP',           key: 'rep',      width: 13, style: { numFmt: fmtCLPx } },
      { header: 'Disposición CLP',       key: 'disp',     width: 15, style: { numFmt: fmtCLPx } },
      { header: 'Gastos Indirectos CLP', key: 'gi',       width: 20, style: { numFmt: fmtCLPx } },
      { header: 'Costo Final CLP',       key: 'final',    width: 16, style: { numFmt: fmtCLPx } },
      { header: 'Costo Final USD',       key: 'finalUsd', width: 16, style: { numFmt: fmtUSDx } },
      { header: 'Tipo Cambio USD',       key: 'tc',       width: 15 },
      { header: 'Peso Kilos',            key: 'kg',       width: 12 },
      { header: 'Litros Formato',        key: 'lt',       width: 14 },
    ]
    ws1.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF2A2B2A' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF7D4' } }
      cell.alignment = { horizontal: 'center' }
    })
    ws1.addRow({
      sku, nombre,
      mp: d.costo_mp_clp, ins: d.costo_insumos_clp,
      mermaF: d.merma_factor, mermaC: +mermaAmt.toFixed(2),
      flete: d.flete_clp || 0, pallet: d.pallet_clp || 0,
      rep: d.ley_rep_clp || 0, disp: d.disposicion_clp || 0,
      gi: d.gtos_indirectos_clp || 0,
      final: d.costo_final_clp,
      finalUsd: +(d.costo_final_clp / tc).toFixed(4),
      tc, kg: d.peso_kilos || '', lt: d.litros_formato || '',
    })

    // ── Hoja 2: Receta Completa ──
    const ws2 = wb.addWorksheet('Receta Completa')
    ws2.columns = [
      { header: 'Sección',      key: 'sec',    width: 26 },
      { header: 'Sub-receta',   key: 'sub',    width: 22 },
      { header: 'Código',       key: 'cod',    width: 16 },
      { header: 'Nombre',       key: 'nom',    width: 38 },
      { header: 'Cantidad',     key: 'cant',   width: 12 },
      { header: 'CU CLP',       key: 'cuClp',  width: 16, style: { numFmt: fmtCLPx } },
      { header: 'CU USD',       key: 'cuUsd',  width: 14, style: { numFmt: fmtUSDx } },
      { header: 'Subtotal CLP', key: 'stClp',  width: 18, style: { numFmt: fmtCLPx } },
      { header: 'Subtotal USD', key: 'stUsd',  width: 16, style: { numFmt: fmtUSDx } },
      { header: 'Fuente',       key: 'fuente', width: 12 },
    ]
    ws2.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF2A2B2A' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF7D4' } }
      cell.alignment = { horizontal: 'center' }
    })

    const stSub:  Partial<ExcelJS.Style> = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF7D4' } } }
    const stTot:  Partial<ExcelJS.Style> = { font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF84BD00' } }, alignment: { horizontal: 'center' } }
    const stSecMP:  Partial<ExcelJS.Style> = { font: { bold: true, color: { argb: 'FF4A7000' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7E6' } } }
    const stSecPkg: Partial<ExcelJS.Style> = { font: { bold: true, color: { argb: 'FF78350F' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } } }
    const stSecGst: Partial<ExcelJS.Style> = { font: { bold: true, color: { argb: 'FF92400E' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } } }

    const addR = (data: Record<string, any>, style?: Partial<ExcelJS.Style>) => {
      const row = ws2.addRow(data)
      if (style) row.eachCell({ includeEmpty: true }, cell => {
        if (style.fill)      cell.fill      = style.fill as ExcelJS.Fill
        if (style.font)      cell.font      = style.font
        if (style.alignment) cell.alignment = style.alignment
      })
      return row
    }

    // Materias primas
    addR({ sec: 'MATERIAS PRIMAS', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: '', stUsd: '', fuente: '' }, stSecMP)
    mpRows.forEach(ins => addR({
      sec: '', sub: ins.subreceta_nombre || '—', cod: ins.insumo_final, nom: ins.nombre_insumo,
      cant: parseFloat(ins.cantidad_requerida_formato) || 0,
      cuClp: parseFloat(ins.costo_unitario_clp_actual) || 0,
      cuUsd: parseFloat(ins.costo_unitario_usd_actual) || 0,
      stClp: parseFloat(ins.costo_teorico_total_clp)   || 0,
      stUsd: parseFloat(ins.costo_teorico_total_usd)   || 0,
      fuente: ins.fuente_costo,
    }))
    addR({ sec: 'SUBTOTAL MATERIAS PRIMAS', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: d.costo_mp_clp, stUsd: +(d.costo_mp_clp / tc).toFixed(4), fuente: '' }, stSub)

    // Packaging
    if (pkgRows.length > 0) {
      ws2.addRow({})
      addR({ sec: 'INSUMOS / PACKAGING', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: '', stUsd: '', fuente: '' }, stSecPkg)
      pkgRows.forEach(ins => addR({
        sec: '', sub: ins.subreceta_nombre || '—', cod: ins.insumo_final, nom: ins.nombre_insumo,
        cant: parseFloat(ins.cantidad_requerida_formato) || 0,
        cuClp: parseFloat(ins.costo_unitario_clp_actual) || 0,
        cuUsd: parseFloat(ins.costo_unitario_usd_actual) || 0,
        stClp: parseFloat(ins.costo_teorico_total_clp)   || 0,
        stUsd: parseFloat(ins.costo_teorico_total_usd)   || 0,
        fuente: ins.fuente_costo,
      }))
      addR({ sec: 'SUBTOTAL PACKAGING', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: d.costo_insumos_clp, stUsd: +(d.costo_insumos_clp / tc).toFixed(4), fuente: '' }, stSub)
    }

    // Gastos adicionales
    if (gastosItems.length > 0) {
      ws2.addRow({})
      addR({ sec: 'GASTOS ADICIONALES', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: '', stUsd: '', fuente: '' }, stSecGst)
      const totalGastos = gastosItems.reduce((s, g) => s + g.clp, 0)
      gastosItems.forEach(g => addR({ sec: '', sub: '', cod: '', nom: g.label, cant: '', cuClp: '', cuUsd: '', stClp: +g.clp.toFixed(2), stUsd: +(g.clp / tc).toFixed(4), fuente: '' }))
      addR({ sec: 'SUBTOTAL GASTOS ADICIONALES', sub: '', cod: '', nom: '', cant: '', cuClp: '', cuUsd: '', stClp: +totalGastos.toFixed(2), stUsd: +(totalGastos / tc).toFixed(4), fuente: '' }, stSub)
    }

    // Costo final
    ws2.addRow({})
    addR({ sec: 'COSTO FINAL', sub: '', cod: sku, nom: nombre, cant: '', cuClp: '', cuUsd: '', stClp: d.costo_final_clp, stUsd: +(d.costo_final_clp / tc).toFixed(4), fuente: '' }, stTot)

    const buf  = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `BOM_${sku}_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click(); URL.revokeObjectURL(url)
  }

  /* ---- Reporte Ejecutivo multi-hoja ---- */
  const exportReporteEjecutivo = async (data: any[]) => {
    const wb   = new ExcelJS.Workbook()
    const today = new Date().toLocaleDateString('es-CL')
    const fmtCLPx = '"$"#,##0'

    const GREEN  = 'FF84BD00'
    const DKGRN  = 'FF4A7000'
    const WHITE  = 'FFFFFFFF'
    const LTGRN  = 'FFEDF7D4'
    const DKGRY  = 'FF2A2B2A'
    const YELLOW = 'FFFFF3CD'
    const RED    = 'FFFDE8E8'

    const hStyle = (fg: string, color = DKGRY): Partial<ExcelJS.Style> => ({
      font:      { bold: true, color: { argb: color } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: {
        bottom: { style: 'thin', color: { argb: 'FFB0C87A' } },
      },
    })
    const applyH = (row: ExcelJS.Row, fg: string, color = DKGRY) =>
      row.eachCell({ includeEmpty: true }, c => {
        const s = hStyle(fg, color)
        c.font = s.font!; c.fill = s.fill!; c.alignment = s.alignment!; c.border = s.border!
      })
    const applyRowFill = (row: ExcelJS.Row, fg: string) =>
      row.eachCell({ includeEmpty: true }, c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } }
      })

    // ── Contadores globales ──────────────────────────────────────────────────
    const total      = data.length
    const completos  = data.filter(r => r.tiene_bom && r.insumos_sin_precio === 0).length
    const incompl    = data.filter(r => r.tiene_bom && r.insumos_sin_precio > 0).length
    const sinBom     = data.filter(r => !r.tiene_bom).length
    const pctCompleto = total > 0 ? +(completos / total * 100).toFixed(1) : 0
    const totalCostoFinal = data.reduce((s, r) => s + (parseFloat(r.costo_final_clp) || 0), 0)

    // Agrupar por familia
    const byFamilia = new Map<string, any[]>()
    for (const r of data) {
      const f = r.familia || '(Sin familia)'
      if (!byFamilia.has(f)) byFamilia.set(f, [])
      byFamilia.get(f)!.push(r)
    }
    const familiasOrdenadas = [...byFamilia.keys()].sort()

    // ── HOJA 1: Resumen Ejecutivo ─────────────────────────────────────────────
    const ws1 = wb.addWorksheet('Resumen Ejecutivo')
    ws1.columns = [
      { key: 'a', width: 28 },
      { key: 'b', width: 18 },
      { key: 'c', width: 18 },
      { key: 'd', width: 18 },
      { key: 'e', width: 18 },
    ]

    // Título
    ws1.mergeCells('A1:E1')
    const titleCell = ws1.getCell('A1')
    titleCell.value = 'REPORTE EJECUTIVO — PASSOL PINTURAS'
    titleCell.font  = { bold: true, size: 16, color: { argb: WHITE } }
    titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws1.getRow(1).height = 36

    ws1.mergeCells('A2:E2')
    const subCell = ws1.getCell('A2')
    subCell.value = `Generado: ${today} · ${total} Productos Terminados analizados`
    subCell.font  = { italic: true, size: 10, color: { argb: DKGRY } }
    subCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LTGRN } }
    subCell.alignment = { horizontal: 'center' }
    ws1.getRow(2).height = 18

    ws1.addRow([])

    // KPI headers
    const kpiHRow = ws1.addRow(['Indicador', 'Total', 'Completos', 'Incompletos', 'Sin BOM'])
    applyH(kpiHRow, DKGRN, WHITE)
    ws1.getRow(kpiHRow.number).height = 22

    const kpiRow = ws1.addRow(['Productos Terminados', total, completos, incompl, sinBom])
    kpiRow.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { bold: col > 1, size: col === 1 ? 10 : 13, color: { argb: col === 1 ? DKGRY : col === 3 ? DKGRN : col === 4 ? 'FFD97706' : col === 5 ? 'FFDC2626' : DKGRY } }
      c.alignment = { horizontal: col === 1 ? 'left' : 'center', vertical: 'middle' }
    })
    ws1.getRow(kpiRow.number).height = 24

    const pctRow = ws1.addRow(['Cobertura completa', `${pctCompleto}%`, '', '', ''])
    pctRow.getCell(1).font = { color: { argb: DKGRY } }
    pctRow.getCell(2).font = { bold: true, color: { argb: pctCompleto >= 80 ? DKGRN : pctCompleto >= 50 ? 'FFD97706' : 'FFDC2626' }, size: 13 }
    pctRow.getCell(2).alignment = { horizontal: 'center' }

    ws1.addRow([])

    // Totales por familia
    const famHRow = ws1.addRow(['Familia', 'Cant. PTs', 'Completos', 'Costo Promedio CLP', 'Total Costo CLP'])
    applyH(famHRow, GREEN, WHITE)
    ws1.getRow(famHRow.number).height = 20

    for (const fam of familiasOrdenadas) {
      const rows   = byFamilia.get(fam)!
      const comp   = rows.filter(r => r.tiene_bom && r.insumos_sin_precio === 0).length
      const costos = rows.map(r => parseFloat(r.costo_final_clp) || 0).filter(v => v > 0)
      const avg    = costos.length > 0 ? costos.reduce((a, b) => a + b, 0) / costos.length : 0
      const tot    = costos.reduce((a, b) => a + b, 0)
      const fr = ws1.addRow([fam, rows.length, comp, +avg.toFixed(0), +tot.toFixed(0)])
      fr.getCell(4).numFmt = fmtCLPx
      fr.getCell(5).numFmt = fmtCLPx
      fr.getCell(2).alignment = { horizontal: 'center' }
      fr.getCell(3).alignment = { horizontal: 'center' }
      fr.getCell(3).font = { color: { argb: comp === rows.length ? DKGRN : 'FFD97706' } }
    }

    // Total final
    ws1.addRow([])
    const totRow = ws1.addRow(['TOTAL GENERAL', total, completos, '', +totalCostoFinal.toFixed(0)])
    totRow.getCell(5).numFmt = fmtCLPx
    applyH(totRow, DKGRN, WHITE)

    // ── HOJA 2: Todos los PTs ────────────────────────────────────────────────
    const ws2 = wb.addWorksheet('Todos los PTs')
    ws2.columns = [
      { header: 'Estado',          key: 'estado',   width: 14 },
      { header: 'SKU',             key: 'sku',      width: 18 },
      { header: 'Nombre',          key: 'nombre',   width: 38 },
      { header: 'Familia',         key: 'familia',  width: 20 },
      { header: 'Subfamilia',      key: 'subfam',   width: 20 },
      { header: 'Sin precio',      key: 'sinp',     width: 12 },
      { header: 'Costo MP CLP',    key: 'mp',       width: 16, style: { numFmt: fmtCLPx } },
      { header: 'Costo Ins CLP',   key: 'ins',      width: 16, style: { numFmt: fmtCLPx } },
      { header: 'Gastos Adic CLP', key: 'gastos',   width: 17, style: { numFmt: fmtCLPx } },
      { header: 'Costo Final CLP', key: 'final',    width: 17, style: { numFmt: fmtCLPx } },
      { header: 'P. Terreno CLP',  key: 'terreno',  width: 16, style: { numFmt: fmtCLPx } },
    ]
    applyH(ws2.getRow(1), GREEN, WHITE)
    ws2.getRow(1).height = 22

    let ws2Row = 2
    for (const fam of familiasOrdenadas) {
      const rows = byFamilia.get(fam)!
      // Subheader familia
      const famRow = ws2.addRow([fam, '', '', '', '', '', '', '', '', '', ''])
      famRow.eachCell({ includeEmpty: true }, c => {
        c.font = { bold: true, color: { argb: DKGRN } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LTGRN } }
      })
      ws2Row++

      const rowsSorted = [...rows].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      for (const r of rowsSorted) {
        const estado = !r.tiene_bom ? 'Sin BOM' : r.insumos_sin_precio > 0 ? 'Incompleto' : 'Completo'
        const dr = ws2.addRow({
          estado,
          sku:     r.sku,
          nombre:  r.nombre,
          familia: r.familia || '',
          subfam:  r.subfamilia || '',
          sinp:    r.insumos_sin_precio || 0,
          mp:      parseFloat(r.costo_mp_clp) || 0,
          ins:     parseFloat(r.costo_insumos_clp) || 0,
          gastos:  parseFloat(r.gastos_adicionales_clp) || 0,
          final:   parseFloat(r.costo_final_clp) || 0,
          terreno: parseFloat(r.precio_terreno_clp) || 0,
        })
        const rowFg = !r.tiene_bom ? RED : r.insumos_sin_precio > 0 ? YELLOW : undefined
        if (rowFg) applyRowFill(dr, rowFg)
        dr.getCell('estado').font = {
          bold: true,
          color: { argb: !r.tiene_bom ? 'FFDC2626' : r.insumos_sin_precio > 0 ? 'FFD97706' : DKGRN }
        }
        ws2Row++
      }

      // Subtotal familia
      const famTotal = rows.reduce((s, r) => s + (parseFloat(r.costo_final_clp) || 0), 0)
      const stRow = ws2.addRow(['', `Subtotal ${fam}`, '', '', '', rows.length, '', '', '', +famTotal.toFixed(0), ''])
      stRow.getCell(2).font = { bold: true, color: { argb: DKGRY } }
      stRow.getCell(6).alignment = { horizontal: 'center' }
      stRow.getCell(10).numFmt = fmtCLPx
      stRow.getCell(10).font = { bold: true, color: { argb: DKGRN } }
      ws2.addRow([])
      ws2Row += 2
    }

    // Total final hoja 2
    const tot2 = ws2.addRow(['', 'TOTAL GENERAL', '', '', '', total, '', '', '', +totalCostoFinal.toFixed(0), ''])
    tot2.getCell(2).font = { bold: true, size: 12, color: { argb: WHITE } }
    tot2.getCell(6).font = { bold: true, color: { argb: WHITE } }
    tot2.getCell(6).alignment = { horizontal: 'center' }
    tot2.getCell(10).numFmt = fmtCLPx
    tot2.getCell(10).font = { bold: true, size: 12, color: { argb: WHITE } }
    applyRowFill(tot2, GREEN)

    // ── HOJA 3: Incompletos ──────────────────────────────────────────────────
    const incompletosData = data.filter(r => r.tiene_bom && r.insumos_sin_precio > 0)
      .sort((a, b) => (b.insumos_sin_precio || 0) - (a.insumos_sin_precio || 0))

    const ws3 = wb.addWorksheet('Incompletos')
    ws3.columns = [
      { header: 'SKU',             key: 'sku',     width: 18 },
      { header: 'Nombre',          key: 'nombre',  width: 38 },
      { header: 'Familia',         key: 'familia', width: 20 },
      { header: 'Insumos sin precio', key: 'sinp', width: 20 },
      { header: 'Costo Final CLP', key: 'final',   width: 17, style: { numFmt: fmtCLPx } },
    ]
    applyH(ws3.getRow(1), 'FFD97706', WHITE)
    ws3.getRow(1).height = 22
    if (incompletosData.length === 0) {
      const r = ws3.addRow(['Sin productos incompletos', '', '', '', ''])
      r.getCell(1).font = { italic: true, color: { argb: DKGRY } }
    } else {
      for (const r of incompletosData) {
        const dr = ws3.addRow({
          sku:    r.sku,
          nombre: r.nombre,
          familia: r.familia || '',
          sinp:   r.insumos_sin_precio || 0,
          final:  parseFloat(r.costo_final_clp) || 0,
        })
        applyRowFill(dr, YELLOW)
        dr.getCell('sinp').font = { bold: true, color: { argb: 'FFD97706' } }
      }
    }

    // ── HOJA 4: Sin BOM ──────────────────────────────────────────────────────
    const sinBomData = data.filter(r => !r.tiene_bom).sort((a, b) => (a.familia || '').localeCompare(b.familia || ''))

    const ws4 = wb.addWorksheet('Sin BOM')
    ws4.columns = [
      { header: 'SKU',        key: 'sku',     width: 18 },
      { header: 'Nombre',     key: 'nombre',  width: 38 },
      { header: 'Familia',    key: 'familia', width: 20 },
      { header: 'Subfamilia', key: 'subfam',  width: 20 },
    ]
    applyH(ws4.getRow(1), 'FFDC2626', WHITE)
    ws4.getRow(1).height = 22
    if (sinBomData.length === 0) {
      const r = ws4.addRow(['Todos los productos tienen BOM', '', '', ''])
      r.getCell(1).font = { italic: true, color: { argb: DKGRY } }
    } else {
      for (const r of sinBomData) {
        const dr = ws4.addRow({ sku: r.sku, nombre: r.nombre, familia: r.familia || '', subfam: r.subfamilia || '' })
        applyRowFill(dr, RED)
      }
    }

    // ── Guardar ──────────────────────────────────────────────────────────────
    const buf  = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Reporte_Ejecutivo_Passol_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---- API calls ---- */
  const loadHistorial = async () => {
    setHistorialLoading(true)
    try {
      const r = await fetchWithRetry(`${API}/api/costos/escenarios-receta`)
      if (r.ok) setHistorial(await r.json())
      else setHistorial([])
    } catch { setHistorial([]) }
    finally { setHistorialLoading(false) }
  }
  const guardarEscenario = async () => {
    if (!escNombre.trim()) { setEscSaveMsg('Ingrese un nombre para el escenario.'); return }
    setEscSaving(true)
    const inicialCLP = explosion?.costo_total_actual_clp || 0
    const simCLP = simResult?.Costo_Simulado_CLP || 0
    const body = {
      nombre: escNombre.trim(),
      sku: explosion?.sku || null,
      nombre_sku: explosion?.nombre || null,
      modo: 'existente',
      costo_original_clp: inicialCLP,
      costo_simulado_clp: simCLP,
      variacion_pct: inicialCLP > 0 ? +((simCLP - inicialCLP) / inicialCLP * 100).toFixed(2) : 0,
      insumos: simInputs,
    }
    try {
      const r = await fetchWithAuth(`${API}/api/costos/escenarios-receta`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (r.ok) { setEscSaveMsg('✅ Escenario guardado'); setEscNombre('') }
      else setEscSaveMsg('Error al guardar')
    } catch { setEscSaveMsg('Error de conexión') }
    finally { setEscSaving(false); setTimeout(() => setEscSaveMsg(''), 3000) }
  }
  const loadAlertas = async (umbral = alertasUmbral) => {
    setAlertasLoading(true)
    try {
      const r = await fetchWithRetry(`${API}/api/costos/alertas-variacion?umbral=${parseFloat(umbral) || 5}`)
      if (r.ok) setAlertas(await r.json())
      else setAlertas([])
    } catch { setAlertas([]) }
    finally { setAlertasLoading(false) }
  }
  const loadDashboard = async () => {
    setDashLoading(true)
    try {
      const r = await fetchWithRetry(`${API}/api/costos/masivo`)
      if (r.ok) setDashData(await r.json())
      else setDashData([])
    } catch {
      setDashData([])
    } finally {
      setDashLoading(false)
    }
  }
  const loadMpList = async (q = mpSearch, tipo = mpTipo, fuente = mpFuente) => {
    setMpLoading(true)
    try {
      const params = new URLSearchParams()
      if (q)      params.set('q', q)
      if (tipo)   params.set('tipo', tipo)
      if (fuente) params.set('fuente', fuente)
      const r = await fetchWithRetry(`${API}/api/costos/materias-primas?${params}`)
      if (r.ok) setMpList(await r.json())
      else setMpList([])
    } catch {
      setMpList([])
    } finally {
      setMpLoading(false)
    }
  }
  const loadClientes = async () => {
    const r = await fetchWithRetry(`${API}/api/clientes/`); if (r.ok) setClientes(await r.json())
  }
  const loadParams = async () => {
    try {
      const r = await fetchWithRetry(`${API}/api/parametros/`)
      if (r.ok) { const d = await r.json(); setParams(d); setEditParams(d) }
      else toast('Error al cargar parámetros', 'error')
    } catch { toast('Sin conexión con el servidor', 'error') }
  }
  const loadSinPrecio = async () => {
    try {
      const r = await fetchWithAuth(`${API}/api/costos/sin_precio`)
      if (r.ok) setSinPrecio(await r.json())
      else toast('Error al cargar insumos sin precio', 'error')
    } catch { toast('Sin conexión con el servidor', 'error') }
  }
  const loadLeyRepFormatos = async () => {
    try {
      const r = await fetchWithAuth(`${API}/api/parametros/ley-rep/`)
      if (r.ok) setLeyRepList(await r.json())
    } catch { /* silencioso — se carga junto a otros */ }
  }
  const loadLeyRepProductos = async () => {
    const r = await fetchWithAuth(`${API}/api/parametros/ley-rep/productos`)
    if (r.ok) setLeyRepProductos(await r.json())
  }
  const saveCLPSku = async (sku: string, clpStr: string) => {
    const clp = parseFloat(clpStr)
    if (isNaN(clp)) return
    await fetchWithAuth(`${API}/api/parametros/ley-rep/skus/${sku}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ley_rep_clp: clp })
    })
    setLeyRepEditCLP(prev => { const n = { ...prev }; delete n[sku]; return n })
    loadLeyRepProductos()
  }
  const loadCostoIndirectos = async () => {
    const r = await fetchWithAuth(`${API}/api/clientes/`)
    if (r.ok) {
      const data: Cliente[] = await r.json()
      setCostoIndirectos(data.map(c => ({
        id: c.id!,
        cliente: c.cliente,
        flete_agua_kilo: c.flete_agua_kilo ?? 0,
        flete_otros_kilo: c.flete_otros_kilo ?? 0,
        pallet_agua_kilo: c.pallet_agua_kilo ?? 0,
        pallet_otros_kilo: c.pallet_otros_kilo ?? 0,
      })))
    }
  }
  const saveCostoIndirectos = async () => {
    const r = await fetchWithAuth(`${API}/api/parametros/costos-indirectos`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(costoIndirectos)
    })
    if (r.ok) { toast('Costos indirectos guardados'); await refreshCadenasData() }
    else toast('Error al guardar', 'error')
  }
  const addClienteIndirecto = async () => {
    const nombre = nuevoClienteNombre.trim()
    if (!nombre) return
    const r = await fetchWithAuth(`${API}/api/clientes/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente: nombre, factor: 1, descuento_max: 0, comision_promedio: 0, rapell: 0, fee: 0, marketing: 0, x_docking: 0, rebate: 0, rebate_centralizacion: 0, flete_por_kilo: 0, flete_agua_kilo: 0, flete_otros_kilo: 0, pallet_agua_kilo: 0, pallet_otros_kilo: 0 })
    })
    if (r.ok) { setNuevoClienteNombre(''); setAddClienteOpen(false); loadCostoIndirectos() }
  }

  const loadCmOverrides = async () => {
    const r = await fetchWithAuth(`${API}/api/costos/manuales`)
    if (r.ok) setCmOverrides(await r.json())
  }
  const KG_UNITS = new Set(['KILOGRAMOS', 'KG', 'KGS', 'KG.', 'KILO'])
  const searchCmInsumo = async (q: string) => {
    setCmSearch(q); setCmSeleccionado(null); setCmPrecioCot(''); setCmDensidad('')
    if (q.length < 2) { setCmResultados([]); setCmSugOpen(false); return }
    const r = await fetchWithAuth(`${API}/api/costos/buscar-insumos?q=${encodeURIComponent(q)}`)
    if (r.ok) { setCmResultados(await r.json()); setCmSugOpen(true) }
  }
  const selectCmInsumo = (ins: InsumoConCosto) => {
    const esKg = KG_UNITS.has((ins.unidad_medida || '').toUpperCase().trim())
    setCmSeleccionado(ins)
    setCmSearch(`${ins.sku} — ${ins.nombre}`)
    setCmPrecioCot('')
    setCmUnidad(esKg ? 'Kg' : 'Lt')
    setCmDensidad(String(ins.densidad ?? 1))
    setCmSugOpen(false)
  }
  // Calcula costo CLP/kg a partir del precio cotización + moneda + unidad + densidad
  const calcCmCostoKg = (): { clp: number; usd: number } | null => {
    const precio = parseFloat(cmPrecioCot)
    if (!cmSeleccionado || isNaN(precio) || precio <= 0) return null
    const tc = cmSeleccionado.tipo_cambio_usd || 950
    const densidad = parseFloat(cmDensidad) || 1
    const precioCLP = cmMoneda === 'USD' ? precio * tc : precio
    const costoClpKg = cmUnidad === 'Lt' ? precioCLP / densidad : precioCLP
    return { clp: costoClpKg, usd: costoClpKg / tc }
  }
  const saveCmCosto = async () => {
    if (!cmSeleccionado) { toast('Selecciona un insumo primero', 'warning'); return }
    if (!cmPrecioCot || parseFloat(cmPrecioCot) <= 0) { toast('Precio de cotización debe ser mayor a 0', 'warning'); return }
    const calc = calcCmCostoKg()
    if (!calc) { toast('No se puede calcular el costo. Verifica densidad y unidades', 'warning'); return }
    const r = await fetchWithAuth(`${API}/api/costos/manual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: cmSeleccionado.sku, costo_unitario_clp: Math.round(calc.clp), notas: '', usuario: 'usuario',
        precio_cotizacion: parseFloat(cmPrecioCot), moneda_cotizacion: cmMoneda, unidad_cotizacion: cmUnidad })
    })
    if (r.ok) { toast('Costo de cotización guardado'); setCmSeleccionado(null); setCmSearch(''); setCmPrecioCot(''); setCmDensidad(''); loadCmOverrides() }
    else toast('Error al guardar', 'error')
  }
  const deleteCmOverride = async (sku: string) => {
    const r = await fetchWithAuth(`${API}/api/costos/manual/${sku}`, { method: 'DELETE' })
    if (r.ok) { toast('Costo eliminado', 'info'); loadCmOverrides() }
    else toast('Error al eliminar', 'error')
  }
  const loadCmInPanel = async (sku: string) => {
    const r = await fetchWithAuth(`${API}/api/costos/buscar-insumos?q=${encodeURIComponent(sku)}`)
    if (!r.ok) return
    const rows: InsumoConCosto[] = await r.json()
    const found = rows.find(x => x.sku === sku)
    if (found) { selectCmInsumo(found); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }
  const calcCmInlineCostoKg = (row: any): { clp: number; usd: number } | null => {
    const precio = parseFloat(cmInlineEditVal)
    if (isNaN(precio) || precio <= 0) return null
    const tc = row.tipo_cambio_usd || 950
    const densidad = parseFloat(cmInlineDensidad) || row.densidad || 1
    const precioCLP = cmInlineMoneda === 'USD' ? precio * tc : precio
    const costoClpKg = cmInlineUnidad === 'Lt' ? precioCLP / densidad : precioCLP
    return { clp: costoClpKg, usd: costoClpKg / tc }
  }
  const saveCmInline = async (sku: string, row: any) => {
    const calc = calcCmInlineCostoKg(row)
    if (!calc) return
    const r = await fetchWithAuth(`${API}/api/costos/manual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, costo_unitario_clp: Math.round(calc.clp), notas: '', usuario: 'usuario',
        precio_cotizacion: parseFloat(cmInlineEditVal), moneda_cotizacion: cmInlineMoneda, unidad_cotizacion: cmInlineUnidad })
    })
    if (r.ok) { toast('Costo actualizado'); setCmInlineEditSku(null); setCmInlineEditVal(''); loadCmOverrides() }
    else toast('Error al guardar', 'error')
  }

  const searchRentSKU = async (q: string) => {
    setRentSearch(q); setRentData(null)
    if (q.length < 2) { setRentSug([]); return }
    const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto+Terminado`)
    if (r.ok) setRentSug(await r.json())
  }
  const loadRentabilidad = async (sku: string, nombre: string) => {
    setRentSearch(nombre); setRentSug([]); setRentLoading(true)
    const r = await fetchWithAuth(`${API}/api/costos/${sku}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setRentData(d)
      // Sincronizar con el Simulador de Rentabilidad
      setSrSearch(nombre)
      setSrData(d)
      setSrSelected(null); setSrResult(null); setSrConfirm(false); setSrSaveMsg('')
      setSrInputs({}); setSrScenName('')
      const e = await fetchWithAuth(`${API}/api/escenarios/?sku=${sku}`)
      if (e.ok) setSrScenarios(await e.json())
    }
    setRentLoading(false)
  }

  // ── Simulador Rentabilidad ──────────────────────────────────
  const searchSrSku = (q: string) => {
    setSrSearch(q); setSrSug([])
    if (q.length < 2) return
    debounceCall('searchSrSku', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto%20Terminado`)
      if (r.ok) setSrSug(await r.json())
    })
  }

  const loadSrData = async (sku: string, nombre: string) => {
    setSrSearch(nombre); setSrSug([]); setSrLoading(true)
    setSrData(null); setSrSelected(null); setSrResult(null); setSrScenarios([])
    const r = await fetchWithAuth(`${API}/api/costos/${sku}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setSrData(d)
      const e = await fetchWithAuth(`${API}/api/escenarios/?sku=${sku}`)
      if (e.ok) setSrScenarios(await e.json())
    }
    setSrLoading(false)
  }

  const selectSrCliente = (rc: any) => {
    setSrSelected(rc)
    setSrResult(null)
    setSrConfirm(false)
    setSrSaveMsg('')
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
    const r = await fetchWithAuth(`${API}/api/rentabilidad/simular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku:            srData.sku,
        costo_base_clp: srData.costo_total_con_merma,
        peso_kg:        srData.peso_kilos || 1,
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
    const r = await fetchWithAuth(`${API}/api/clientes/${srInputs._clienteId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (r.ok) {
      setSrSaveMsg('✓ Condiciones actualizadas correctamente')
      setSrConfirm(false)
      await refreshCadenasData()
    } else {
      setSrSaveMsg('⚠ Error al guardar condiciones')
    }
  }

  const guardarEscenarioSr = async () => {
    if (!srScenName.trim() || !srResult) return
    const r = await fetchWithAuth(`${API}/api/escenarios/`, {
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
      const e = await fetchWithAuth(`${API}/api/escenarios/?sku=${srData.sku}`)
      if (e.ok) setSrScenarios(await e.json())
    }
  }

  const eliminarEscenarioSr = async (id: number) => {
    const r = await fetchWithAuth(`${API}/api/escenarios/${id}`, { method: 'DELETE' })
    if (r.ok) setSrScenarios(srScenarios.filter((s: any) => s.id !== id))
  }

  // ── Simulador Masivo (por familia) ────────────────────────────
  const srMasivToStrs = (vals: any): Record<string,string> => {
    const strs: Record<string,string> = {}
    for (const k of _condNumFields) { const v = vals?.[k]; strs[k] = (v != null && v !== 0) ? String(v) : '' }
    return strs
  }

  const onSrMasivFamiliaChange = async (fam: string) => {
    setSrMasivFamilia(fam); setSrMasivSubfamilia(''); setSrMasivResultados([]); setSrMasivInputsLoaded(false)
    const url = fam
      ? `${API}/api/costos/subfamilias?familia=${encodeURIComponent(fam)}`
      : `${API}/api/costos/subfamilias`
    const r = await fetch(url)
    if (r.ok) setSrMasivSubfamilias(await r.json())
  }

  const loadSrMasivCondiciones = () => {
    const cadena = clientes.find((c: any) => c.id === srMasivCadenaId)
    if (!cadena) return
    const vals = {
      factor:               cadena.factor ?? 1,
      descuento_max:        cadena.descuento_max ?? 0,
      comision_promedio:    cadena.comision_promedio ?? 0,
      rapell:               cadena.rapell ?? 0,
      fee:                  cadena.fee ?? 0,
      marketing:            cadena.marketing ?? 0,
      x_docking:            cadena.x_docking ?? 0,
      rebate:               cadena.rebate ?? 0,
      rebate_centralizacion:cadena.rebate_centralizacion ?? 0,
      flete_agua_kilo:      cadena.flete_agua_kilo ?? 0,
      flete_otros_kilo:     cadena.flete_otros_kilo ?? 0,
      pallet_agua_kilo:     cadena.pallet_agua_kilo ?? 0,
      pallet_otros_kilo:    cadena.pallet_otros_kilo ?? 0,
    }
    setSrMasivInputs(vals)
    setSrMasivInputsOrig(vals)
    setSrMasivStrs(srMasivToStrs(vals))
    setSrMasivInputsLoaded(true)
    setSrMasivResultados([])
  }

  const simularMasivo = async () => {
    if (!srMasivFamilia || !srMasivCadenaId || !srMasivInputsLoaded) return
    setSrMasivLoading(true)
    const r = await fetchWithAuth(`${API}/api/rentabilidad/simular-masivo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familia:    srMasivFamilia,
        subfamilia: srMasivSubfamilia,
        cadena_id:  srMasivCadenaId,
        ...srMasivInputs,
      }),
    })
    if (r.ok) setSrMasivResultados(await r.json())
    setSrMasivLoading(false)
  }

  const searchProdSku = (q: string) => {
    setProdSearch(q); setProdSku(''); setProdNombre(''); setProdFicha(null); setProdHistorial([]); setProdSaveMsg('')
    if (q.length < 2) { setProdSug([]); return }
    debounceCall('searchProdSku', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto+Terminado`)
      if (r.ok) setProdSug(await r.json())
    })
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

  const searchInsSku = (q: string) => {
    setInsSearch(q); setInsSku(''); setInsNombre(''); setInsHistorial([])
    if (q.length < 2) { setInsSug([]); return }
    debounceCall('searchInsSku', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Insumo`)
      if (r.ok) setInsSug(await r.json())
    })
  }
  const selectInsSku = async (sku: string, nombre: string) => {
    setInsSearch(nombre); setInsSku(sku); setInsNombre(nombre); setInsSug([]); setInsLoading(true)
    setInsFechaDesde(''); setInsFechaHasta('')
    const r = await fetchWithAuth(`${API}/api/productos/${sku}/historial`)
    if (r.ok) setInsHistorial(await r.json())
    setInsLoading(false)
  }

  const saveProdFicha = async () => {
    if (!prodSku) return
    setProdSaving(true); setProdSaveMsg('')
    const r = await fetchWithAuth(`${API}/api/productos/${prodSku}/ficha`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prodEdit)
    })
    if (r.ok) { const d = await r.json(); setProdFicha(d); setProdSaveMsg('✓ Guardado correctamente') }
    else setProdSaveMsg('⚠ Error al guardar')
    setProdSaving(false)
  }

  const saveLeyRepFormato = async (item: LeyRepFormato) => {
    if (!item.formato) return
    const isNew = !item.id
    const r = await fetch(isNew ? `${API}/api/parametros/ley-rep/` : `${API}/api/parametros/ley-rep/${item.id}`, {
      method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item)
    })
    if (r.ok) { loadLeyRepFormatos(); setLeyRepEdit(null); setLeyRepAddOpen(false); setLeyRepNew({ formato: '', uf_por_formato: 0 }) }
  }
  const deleteLeyRepFormato = (id: number) => {
    confirmAction('¿Eliminar este formato de Ley REP?', async () => {
      const r = await fetchWithAuth(`${API}/api/parametros/ley-rep/${id}`, { method: 'DELETE' })
      if (r.ok) { toast('Formato eliminado', 'info'); loadLeyRepFormatos() }
    })
  }

  const saveParams = async () => {
    if (!editParams) return
    const errs: string[] = []
    if (editParams.merma_global_factor < 1)  errs.push('Merma global debe ser ≥ 1 (ej: 1.05)')
    if (editParams.costo_flete_base_kilo < 0) errs.push('Flete base no puede ser negativo')
    if (editParams.gastos_indirectos_porcentaje < 0 || editParams.gastos_indirectos_porcentaje > 1)
      errs.push('Gastos indirectos debe ser entre 0 y 1 (ej: 0.05)')
    if (errs.length) { toast(errs[0], 'warning'); return }

    try {
      const r = await fetchWithAuth(`${API}/api/parametros/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editParams) })
      if (r.ok) { setParams(editParams); toast('Parámetros guardados') }
      else toast('Error al guardar parámetros', 'error')
    } catch { toast('Sin conexión con el servidor', 'error') }
  }
  const fetchTipoCambio = async () => {
    setTcFetching(true); setTcFetched(null)
    try {
      const [rUsd, rEur] = await Promise.all([
        fetch('https://mindicador.cl/api/dolar'),
        fetch('https://mindicador.cl/api/euro')
      ])
      if (!rUsd.ok || !rEur.ok) throw new Error('Error de red')
      const dUsd = await rUsd.json()
      const dEur = await rEur.json()
      const usd = dUsd.serie?.[0]?.valor ?? 0
      const eur = dEur.serie?.[0]?.valor ?? 0
      const fecha = dUsd.serie?.[0]?.fecha?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
      setTcFetched({ usd, eur, fecha })
      // Pre-llenar los campos de edición
      if (editParams) setEditParams({ ...editParams, tipo_cambio_usd: usd, tipo_cambio_eur: eur })
    } catch {
      toast('No se pudo obtener el tipo de cambio desde mindicador.cl', 'error')
    } finally {
      setTcFetching(false)
    }
  }
  const saveTipoCambio = async () => {
    if (!tcFetched && !editParams) return
    const usd = editParams?.tipo_cambio_usd ?? 0
    const eur = editParams?.tipo_cambio_eur ?? 0
    const fecha = tcFetched?.fecha ?? new Date().toISOString().slice(0, 10)
    await fetchWithAuth(`${API}/api/parametros/tipo-cambio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usd, eur, fecha })
    })
    await saveParams()
    setTcFetched(null)
  }

  // Refresca todos los tabs de Cadenas tras cualquier cambio en condiciones comerciales
  const refreshCadenasData = async () => {
    await loadClientes()
    await loadCostoIndirectos()
    if (rentData?.sku) await loadRentabilidad(rentData.sku, rentSearch)
    else if (srData?.sku) await loadSrData(srData.sku, srSearch)
  }

  const saveCliente = async () => {
    if (!editCliente) return
    const errs: string[] = []
    if (!editCliente.cliente?.trim())          errs.push('Nombre de cadena requerido')
    if (!editCliente.factor || editCliente.factor <= 0) errs.push('Factor debe ser mayor a 0')
    if (editCliente.descuento_max < 0 || editCliente.descuento_max > 1) errs.push('Descuento debe estar entre 0 y 1')
    if (errs.length) { toast(errs[0], 'warning'); return }

    const isNew = !editCliente.id
    try {
      const r = await fetch(isNew ? `${API}/api/clientes/` : `${API}/api/clientes/${editCliente.id}`, {
        method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editCliente)
      })
      if (r.ok) { toast(isNew ? 'Cadena creada' : 'Cadena actualizada'); await refreshCadenasData(); setEditCliente(null) }
      else { const e = await r.json().catch(() => ({})); toast(e.detail || 'Error al guardar', 'error') }
    } catch { toast('Sin conexión con el servidor', 'error') }
  }

  const deleteCliente = (id: number) => {
    confirmAction('¿Eliminar cliente?', async () => {
      const r = await fetchWithAuth(`${API}/api/clientes/${id}`, { method: 'DELETE' })
      if (r.ok) { toast('Cliente eliminado', 'info'); refreshCadenasData() }
    })
  }

  const uploadExcel = async () => {
    if (!file) { setUploadStatus('Selecciona un archivo'); return }
    setUploadStatus('Procesando...')
    setUploadRecalculo(null)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetchWithAuth(`${API}/api/upload/excel`, { method: 'POST', body: fd })
    if (r.ok) {
      const data = await r.json()
      setUploadStatus('Archivo procesado correctamente.')
      setUploadRecalculo(data.recalculo || null)
    } else {
      setUploadStatus('Error: ' + (await r.json()).detail)
    }
  }

  // ── Google Sheets sync ─────────────────────────────────────────────────────
  const [gsyncLoading, setGsyncLoading]   = useState(false)
  const [gsyncResult,  setGsyncResult]    = useState<any>(null)

  const sincronizarGoogleSheets = async () => {
    setGsyncLoading(true)
    setGsyncResult(null)
    try {
      const r = await fetchWithAuth(`${API}/api/upload/google-sheets`, { method: 'POST' })
      const data = await r.json()
      if (r.ok) {
        setGsyncResult({ ok: true, ...data })
        toast(data.mensaje || 'Sincronización exitosa', 'success')
      } else {
        setGsyncResult({ ok: false, mensaje: data.detail || 'Error desconocido' })
        toast(data.detail || 'Error al sincronizar', 'error')
      }
    } catch {
      setGsyncResult({ ok: false, mensaje: 'Sin conexión con el servidor' })
      toast('Sin conexión con el servidor', 'error')
    } finally {
      setGsyncLoading(false)
    }
  }

  const recalcularCostos = async () => {
    setRecalculoLoading(true)
    setRecalculoResult(null)
    const r = await fetchWithAuth(`${API}/api/upload/recalcular`, { method: 'POST' })
    if (r.ok) setRecalculoResult(await r.json())
    else setRecalculoResult({ skus_afectados: 0, filas_eliminadas: 0, message: 'Error al ejecutar el recálculo.' })
    setRecalculoLoading(false)
  }

  // ── Consulta: búsqueda y explosión propias ──
  const searchCPT = (text: string) => {
    setCSearch(text); setCSku('')
    if (!text.trim()) { setCSug([]); return }
    debounceCall('searchCPT', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}&tipo=Producto%20Terminado`)
      if (r.ok) setCSug(await r.json())
    })
  }

  const selectCPT = (sku: string, nombre: string) => {
    setCSku(sku); setCNombre(nombre); setCSearch(`${sku} — ${nombre}`); setCSug([]); loadCExplosion(sku)
  }

  const loadCExplosion = async (sku?: string) => {
    const s = sku || cSku || cSearch; if (!s) return
    const r = await fetchWithAuth(`${API}/api/costos/${s}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setCExplosion(d)
      // Sincronizar panel PV con override guardado
      setPvMargen(d.pv_activo ? String(d.pv_margen_pct) : '')
      const aj = d.pv_activo && d.pv_ajuste_pct !== 0 ? d.pv_ajuste_pct : 0
      setPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
      setPvAjusteSign(aj < 0 ? '-' : '+')
      setPvSaveMsg('')
    }
  }

  const clearCExplosion = () => { setCExplosion(null); setCSearch(''); setCSku(''); setCNombre(''); setPvMargen(''); setPvAjuste(''); setPvAjusteSign('+'); setPvSaveMsg('') }

  const savePrecioVenta = async () => {
    if (!cExplosion) return
    const margen = parseFloat(pvMargen.replace(',', '.')) || 0
    const absAjuste = parseFloat(pvAjuste.replace(',', '.')) || 0
    const ajuste = pvAjusteSign === '-' ? -absAjuste : absAjuste
    setPvSaving(true)
    const r = await fetchWithAuth(`${API}/api/costos/${cExplosion.sku}/precio-venta`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margen_pct: margen, ajuste_pct: ajuste, costo_final_clp: cExplosion.costo_final_clp })
    })
    if (r.ok) { const d = await r.json(); setCExplosion((prev: any) => ({ ...prev, pv_activo: true, pv_margen_pct: d.margen_pct, pv_ajuste_pct: d.ajuste_pct, pv_precio_venta: d.precio_venta_clp, pv_precio_final: d.precio_final_clp })); setPvSaveMsg('Guardado') }
    else setPvSaveMsg('Error al guardar')
    setPvSaving(false)
  }

  const resetPrecioVenta = async () => {
    if (!cExplosion) return
    setPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/${cExplosion.sku}/precio-venta`, { method: 'DELETE' })
    setCExplosion((prev: any) => ({ ...prev, pv_activo: false, pv_margen_pct: 0, pv_ajuste_pct: 0, pv_precio_venta: 0, pv_precio_final: 0 }))
    setPvMargen(''); setPvAjuste(''); setPvAjusteSign('+'); setPvSaveMsg('Restablecido')
    setPvSaving(false)
  }

  // ── Simulador: búsqueda y explosión propias ──
  const searchSimPT = (text: string) => {
    setSimSearch(text); setSkuSim('')
    if (!text.trim()) { setSimSug([]); return }
    debounceCall('searchSimPT', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}&tipo=Producto%20Terminado`)
      if (r.ok) setSimSug(await r.json())
    })
  }

  const selectSimPT = (sku: string, nombre: string) => {
    setSkuSim(sku); setSimSearch(`${sku} — ${nombre}`); setSimSug([]); loadSimExplosion(sku)
  }

  const searchBaseSku = async (q: string) => {
    setBaseSearch(q); setBaseSku('')
    if (!q.trim()) { setBaseSug([]); return }
    const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto%20Terminado`)
    if (r.ok) setBaseSug(await r.json())
  }

  const selectBaseSku = async (sku: string, nombre: string) => {
    setBaseSku(sku); setBaseNombre(nombre); setBaseSearch(nombre); setBaseSug([])
    setBaseResult(null); setBaseParams(null); setBaseCosto('')
    // Cargar parámetros globales, ley_rep y explosión real en paralelo
    const [rp, rl, re] = await Promise.all([
      fetch(`${API}/api/parametros/`),
      fetch(`${API}/api/costos/${sku}/ley-rep`),
      fetch(`${API}/api/costos/${sku}/explosion`),
    ])
    const p  = rp.ok ? await rp.json() : {}
    const lr = rl.ok ? await rl.json() : {}
    const ex = re.ok ? await re.json() : {}
    // Prellenar costo base con el costo_final_clp real del producto
    if (ex.costo_final_clp) setBaseCosto(String(Math.round(ex.costo_final_clp)))
    setBaseParams({
      merma_factor:      String(p.merma_global_factor ?? 1),
      flete_base_kilo:   String(p.costo_flete_base_kilo ?? 0),
      pallet_base_kilo:  String(p.costo_pallet_base_kilo ?? 0),
      ley_rep_clp:       lr.ley_rep_clp != null ? String(lr.ley_rep_clp) : '',
      disposicion_kilo:  String(p.disposicion_por_kilo ?? 0),
      gastos_indirectos: String(p.gastos_indirectos_porcentaje ?? 0),
    })
  }

  const calcularPrecioDesdeBase = async () => {
    if (!baseSku || !baseCosto) return
    setBaseLoading(true)
    const body: any = { sku: baseSku, costo_base_clp: parseFloat(baseCosto) || 0 }
    if (baseParams) {
      if (baseParams.merma_factor)      body.merma_factor      = parseFloat(baseParams.merma_factor)
      if (baseParams.flete_base_kilo)   body.flete_base_kilo   = parseFloat(baseParams.flete_base_kilo)
      if (baseParams.pallet_base_kilo)  body.pallet_base_kilo  = parseFloat(baseParams.pallet_base_kilo)
      if (baseParams.ley_rep_clp)       body.ley_rep_clp       = parseFloat(baseParams.ley_rep_clp)
      if (baseParams.disposicion_kilo)  body.disposicion_kilo  = parseFloat(baseParams.disposicion_kilo)
      if (baseParams.gastos_indirectos) body.gastos_indirectos = parseFloat(baseParams.gastos_indirectos)
    }
    const r = await fetchWithAuth(`${API}/api/costos/precio-desde-base`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (r.ok) setBaseResult(await r.json())
    setBaseLoading(false)
  }

  const loadSimExplosion = async (sku?: string) => {
    const s = sku || skuSim || simSearch; if (!s) return
    const r = await fetchWithAuth(`${API}/api/costos/${s}/explosion`)
    const d = await r.json(); setExplosion(d)
    if (d.detalle_insumos) {
      const si: any = {}
      d.detalle_insumos.forEach((x: any) => {
        if (si[x.insumo_final]) {
          si[x.insumo_final].cantidad += x.cantidad_requerida_formato
        } else {
          si[x.insumo_final] = { costo: x.costo_unitario_clp_actual, cantidad: x.cantidad_requerida_formato, nombre: x.nombre_insumo, familia: x.familia || '', subreceta_sku: x.subreceta_sku || null, subreceta_nombre: x.subreceta_nombre || null }
        }
      })
      setSimInputs(si)
    }
    setSimResult(null)
  }

  const clearExplosion = () => {
    setExplosion(null); setSimSearch(''); setSkuSim(''); setSimSug([]); setSimResult(null)
    setSimLibreItems([])
    setSimLibreNombre('')
    setSimLibreCantidad(0)
    setSimLibreCosto(0)
    setSimLibreOpen(false)
  }

  // ---------- Consulta Masiva ----------
  const loadFamilias = async () => {
    const [rFam, rSub] = await Promise.all([
      fetch(`${API}/api/costos/familias`),
      fetch(`${API}/api/costos/subfamilias`),
    ])
    if (rFam.ok) setMasivFamilias(await rFam.json())
    if (rSub.ok) setMasivSubfamilias(await rSub.json())
  }

  const onFamiliaChange = async (fam: string) => {
    setMasivFamilia(fam)
    setMasivSubfamilia('')
    setMasivResultados([])
    setMasivExplosion(null)
    // Al elegir familia, filtra subfamilias; si no hay familia, carga todas
    const url = fam
      ? `${API}/api/costos/subfamilias?familia=${encodeURIComponent(fam)}`
      : `${API}/api/costos/subfamilias`
    const r = await fetch(url)
    if (r.ok) setMasivSubfamilias(await r.json())
  }

  const loadMasivo = async () => {
    setMasivLoading(true)
    setMasivExplosion(null)
    setMasivPvSaveMsg('')
    const qp = new URLSearchParams()
    if (masivFamilia) qp.append('familia', masivFamilia)
    if (masivSubfamilia) qp.append('subfamilia', masivSubfamilia)
    const r = await fetchWithAuth(`${API}/api/costos/masivo?${qp}`)
    if (r.ok) setMasivResultados(await r.json())
    setMasivLoading(false)
  }

  const loadMasivExplosion = async (sku: string, nombre: string) => {
    const r = await fetchWithAuth(`${API}/api/costos/${sku}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setMasivExplosion({ sku, nombre, data: d })
      setMasivSkuPvMargen(d.pv_activo ? String(d.pv_margen_pct) : '')
      const aj = d.pv_activo && d.pv_ajuste_pct !== 0 ? d.pv_ajuste_pct : 0
      setMasivSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
      setMasivSkuPvAjusteSign(aj < 0 ? '-' : '+')
      setMasivSkuPvSaveMsg('')
    }
  }

  const saveMasivoPV = async () => {
    const margen = parseFloat(masivPvMargen.replace(',', '.')) || 0
    const absAjuste = parseFloat(masivPvAjuste.replace(',', '.')) || 0
    const ajuste = masivPvAjusteSign === '-' ? -absAjuste : absAjuste
    const items = masivResultados
      .filter((pt: any) => pt.costo_final_clp > 0)
      .map((pt: any) => ({ sku: pt.sku, costo_final_clp: pt.costo_final_clp }))
    if (!items.length) return
    setMasivPvSaving(true)
    const r = await fetchWithAuth(`${API}/api/costos/masivo/precio-venta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, margen_pct: margen, ajuste_pct: ajuste }),
    })
    if (r.ok) {
      setMasivResultados(prev => prev.map((pt: any) => {
        if (pt.costo_final_clp <= 0) return pt
        const pv = pt.costo_final_clp * (1 + margen / 100)
        const pf = pv * (1 + ajuste / 100)
        return { ...pt, pv_activo: true, precio_terreno_clp: Math.round(pf) }
      }))
      setMasivPvSaveMsg('Guardado')
    } else {
      setMasivPvSaveMsg('Error al guardar')
    }
    setMasivPvSaving(false)
  }

  const resetMasivoPV = async () => {
    const skus = masivResultados.map((pt: any) => pt.sku)
    setMasivPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/masivo/precio-venta/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus }),
    })
    setMasivResultados(prev => prev.map((pt: any) => ({
      ...pt,
      pv_activo: false,
      precio_terreno_clp: (pt.costo_final_clp || 0) + (pt.flete_terreno_clp || 0) + (pt.pallet_terreno_clp || 0),
    })))
    setMasivPvMargen(''); setMasivPvAjuste(''); setMasivPvSaveMsg('Restablecido')
    setMasivPvSaving(false)
  }

  const saveMasivSkuPV = async () => {
    if (!masivExplosion) return
    const margen = parseFloat(masivSkuPvMargen.replace(',', '.')) || 0
    const absAjuste = parseFloat(masivSkuPvAjuste.replace(',', '.')) || 0
    const ajuste = masivSkuPvAjusteSign === '-' ? -absAjuste : absAjuste
    setMasivSkuPvSaving(true)
    const r = await fetchWithAuth(`${API}/api/costos/${masivExplosion.sku}/precio-venta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margen_pct: margen, ajuste_pct: ajuste, costo_final_clp: masivExplosion.data.costo_final_clp }),
    })
    if (r.ok) {
      const d = await r.json()
      setMasivExplosion(prev => prev ? { ...prev, data: { ...prev.data, pv_activo: true, pv_margen_pct: d.margen_pct, pv_ajuste_pct: d.ajuste_pct, pv_precio_venta: d.precio_venta_clp, pv_precio_final: d.precio_final_clp } } : prev)
      const pf = masivExplosion.data.costo_final_clp * (1 + margen / 100) * (1 + ajuste / 100)
      setMasivResultados(prev => prev.map((pt: any) => pt.sku === masivExplosion.sku ? { ...pt, pv_activo: true, precio_terreno_clp: Math.round(pf) } : pt))
      setMasivSkuPvSaveMsg('Guardado')
    } else {
      setMasivSkuPvSaveMsg('Error al guardar')
    }
    setMasivSkuPvSaving(false)
  }

  const resetMasivSkuPV = async () => {
    if (!masivExplosion) return
    setMasivSkuPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/${masivExplosion.sku}/precio-venta`, { method: 'DELETE' })
    setMasivExplosion(prev => prev ? { ...prev, data: { ...prev.data, pv_activo: false, pv_margen_pct: 0, pv_ajuste_pct: 0, pv_precio_venta: 0, pv_precio_final: 0 } } : prev)
    setMasivResultados(prev => prev.map((pt: any) => pt.sku === masivExplosion.sku ? {
      ...pt, pv_activo: false,
      precio_terreno_clp: (pt.costo_final_clp || 0) + (pt.flete_terreno_clp || 0) + (pt.pallet_terreno_clp || 0),
    } : pt))
    setMasivSkuPvMargen(''); setMasivSkuPvAjuste(''); setMasivSkuPvSaveMsg('Restablecido')
    setMasivSkuPvSaving(false)
  }

  // ── Cadenas helpers ──
  const searchCadSku = async (q: string) => {
    setCadSkuSearch(q); setCadSku(''); setCadSkuNombre(''); setCadExplosion(null)
    if (q.length < 2) { setCadSkuSug([]); return }
    const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(q)}&tipo=Producto+Terminado`)
    if (r.ok) setCadSkuSug(await r.json())
  }
  const selectCadSku = async (sku: string, nombre: string) => {
    setCadSkuSearch(nombre); setCadSku(sku); setCadSkuNombre(nombre); setCadSkuSug([]); setCadSkuLoading(true)
    const r = await fetchWithAuth(`${API}/api/costos/${sku}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setCadExplosion(d)
      setCadSkuPvMargen(d.pv_activo ? String(d.pv_margen_pct) : '')
      const aj = d.pv_activo && d.pv_ajuste_pct !== 0 ? d.pv_ajuste_pct : 0
      setCadSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
      setCadSkuPvAjusteSign(aj < 0 ? '-' : '+')
      setCadSkuPvSaveMsg('')
    }
    setCadSkuLoading(false)
  }

  const saveCadSkuPV = async () => {
    if (!cadSku || !cadExplosion) return
    const margen = parseFloat(cadSkuPvMargen.replace(',', '.')) || 0
    const absAj  = parseFloat(cadSkuPvAjuste.replace(',', '.')) || 0
    const ajuste = cadSkuPvAjusteSign === '-' ? -absAj : absAj
    const rent   = cadExplosion.rentabilidad_clientes || []
    const rentEx = rent.find((r: any) => r.cliente === cadExpandida)
    const costoBase = rentEx?.costo_parcial || cadExplosion.costo_final_clp
    setCadSkuPvSaving(true)
    const r = await fetchWithAuth(`${API}/api/costos/${cadSku}/precio-venta`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margen_pct: margen, ajuste_pct: ajuste, costo_final_clp: costoBase }),
    })
    if (r.ok) {
      const d = await r.json()
      setCadExplosion((prev: any) => ({ ...prev, pv_activo: true, pv_margen_pct: d.margen_pct, pv_ajuste_pct: d.ajuste_pct, pv_precio_venta: d.precio_venta_clp, pv_precio_final: d.precio_final_clp }))
      setCadSkuPvSaveMsg('Guardado')
    } else { setCadSkuPvSaveMsg('Error al guardar') }
    setCadSkuPvSaving(false)
  }

  const resetCadSkuPV = async () => {
    if (!cadSku) return
    setCadSkuPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/${cadSku}/precio-venta`, { method: 'DELETE' })
    setCadExplosion((prev: any) => ({ ...prev, pv_activo: false, pv_margen_pct: 0, pv_ajuste_pct: 0, pv_precio_venta: 0, pv_precio_final: 0 }))
    setCadSkuPvMargen(''); setCadSkuPvAjuste(''); setCadSkuPvAjusteSign('+'); setCadSkuPvSaveMsg('Restablecido')
    setCadSkuPvSaving(false)
  }

  const loadCadMasivExplosion = async (sku: string, nombre: string) => {
    const r = await fetchWithAuth(`${API}/api/costos/${sku}/explosion`)
    if (r.ok) {
      const d = await r.json()
      setCadMasivExplosion({ sku, nombre, data: d })
      setCadMasivSkuPvMargen(d.pv_activo ? String(d.pv_margen_pct) : '')
      const aj = d.pv_activo && d.pv_ajuste_pct !== 0 ? d.pv_ajuste_pct : 0
      setCadMasivSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
      setCadMasivSkuPvAjusteSign(aj < 0 ? '-' : '+')
      setCadMasivSkuPvSaveMsg('')
    }
  }

  const saveCadMasivSkuPV = async () => {
    if (!cadMasivExplosion) return
    const cadenaRow = cadMasivResultados.find((r: any) => r.sku === cadMasivExplosion.sku)
    const costoBase = cadenaRow?.costo_parcial || cadMasivExplosion.data.costo_final_clp
    const margen = parseFloat(cadMasivSkuPvMargen.replace(',', '.')) || 0
    const absAj  = parseFloat(cadMasivSkuPvAjuste.replace(',', '.')) || 0
    const ajuste = cadMasivSkuPvAjusteSign === '-' ? -absAj : absAj
    setCadMasivSkuPvSaving(true)
    const r = await fetchWithAuth(`${API}/api/costos/${cadMasivExplosion.sku}/precio-venta`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margen_pct: margen, ajuste_pct: ajuste, costo_final_clp: costoBase }),
    })
    if (r.ok) {
      const d = await r.json()
      setCadMasivExplosion(prev => prev ? { ...prev, data: { ...prev.data, pv_activo: true, pv_margen_pct: d.margen_pct, pv_ajuste_pct: d.ajuste_pct, pv_precio_venta: d.precio_venta_clp, pv_precio_final: d.precio_final_clp } } : prev)
      await loadCadMasivo()
      setCadMasivSkuPvSaveMsg('Guardado')
    } else { setCadMasivSkuPvSaveMsg('Error al guardar') }
    setCadMasivSkuPvSaving(false)
  }

  const resetCadMasivSkuPV = async () => {
    if (!cadMasivExplosion) return
    setCadMasivSkuPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/${cadMasivExplosion.sku}/precio-venta`, { method: 'DELETE' })
    setCadMasivExplosion(prev => prev ? { ...prev, data: { ...prev.data, pv_activo: false, pv_margen_pct: 0, pv_ajuste_pct: 0, pv_precio_venta: 0, pv_precio_final: 0 } } : prev)
    await loadCadMasivo()
    setCadMasivSkuPvMargen(''); setCadMasivSkuPvAjuste(''); setCadMasivSkuPvAjusteSign('+'); setCadMasivSkuPvSaveMsg('Restablecido')
    setCadMasivSkuPvSaving(false)
  }

  const saveCadMasivoPV = async () => {
    const margen = parseFloat(cadMasivPvMargen.replace(',', '.')) || 0
    const absAj  = parseFloat(cadMasivPvAjuste.replace(',', '.')) || 0
    const ajuste = cadMasivPvAjusteSign === '-' ? -absAj : absAj
    const items  = cadMasivResultados
      .filter((r: any) => (r.costo_parcial || 0) > 0)
      .map((r: any) => ({ sku: r.sku, costo_final_clp: r.costo_parcial }))
    if (!items.length) return
    setCadMasivPvSaving(true)
    const res = await fetchWithAuth(`${API}/api/costos/masivo/precio-venta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, margen_pct: margen, ajuste_pct: ajuste }),
    })
    if (res.ok) {
      await loadCadMasivo()
      setCadMasivPvSaveMsg('Guardado')
    } else { setCadMasivPvSaveMsg('Error al guardar') }
    setCadMasivPvSaving(false)
  }

  const resetCadMasivoPV = async () => {
    const skus = cadMasivResultados.map((r: any) => r.sku)
    setCadMasivPvSaving(true)
    await fetchWithAuth(`${API}/api/costos/masivo/precio-venta/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus }),
    })
    await loadCadMasivo()
    setCadMasivPvMargen(''); setCadMasivPvAjuste(''); setCadMasivPvAjusteSign('+'); setCadMasivPvSaveMsg('Restablecido')
    setCadMasivPvSaving(false)
  }

  const onCadFamiliaChange = async (fam: string) => {
    setCadMasivFamilia(fam); setCadMasivSubfamilia(''); setCadMasivResultados([])
    const url = fam ? `${API}/api/costos/subfamilias?familia=${encodeURIComponent(fam)}` : `${API}/api/costos/subfamilias`
    const r = await fetch(url)
    if (r.ok) setCadMasivSubfamilias(await r.json())
  }
  const loadCadMasivo = async () => {
    if (!cadMasivClienteId) return
    setCadMasivLoading(true)
    const qp = new URLSearchParams({ cadena_id: String(cadMasivClienteId) })
    if (cadMasivFamilia) qp.append('familia', cadMasivFamilia)
    if (cadMasivSubfamilia) qp.append('subfamilia', cadMasivSubfamilia)
    const r = await fetchWithAuth(`${API}/api/costos/masivo-cadenas?${qp}`)
    if (r.ok) setCadMasivResultados(await r.json())
    setCadMasivLoading(false)
  }
  // -------------------------------------

  const handleSimular = async () => {
    const skuTarget = explosion?.sku || skuSim
    if (!skuTarget) return
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
    const r = await fetchWithAuth(`${API}/api/costos/${skuTarget}/simulacion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insumos, moneda_simulacion: 'CLP' })
    })
    if (r.ok) setSimResult(await r.json())
  }

  const searchInsumoFn = (text: string) => {
    setSearchInsumo(text)
    if (!text.trim()) { setInsumosSug([]); return }
    debounceCall('searchInsumoFn', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}&tipo=Insumo`)
      if (r.ok) setInsumosSug(await r.json())
    })
  }

  const addInsumo = (ins: any) => {
    setNuevaInsumos([...nuevaInsumos, {
      ...ins,
      cantidad_requerida_formato: 0,
      costo_teorico_total_clp: 0,
      costo_teorico_total_usd: 0,
      isManual: false
    }])
    setSearchInsumo(''); setInsumosSug([])
  }

  const addInsumoManual = () => {
    setNuevaInsumos([...nuevaInsumos, {
      sku: '', nombre: '', cantidad_requerida_formato: 0,
      costo_unitario_clp: 0, costo_unitario_usd: 0,
      costo_teorico_total_clp: 0, costo_teorico_total_usd: 0,
      isManual: true
    }])
  }

  const simAddSearchFn = (text: string) => {
    setSimAddSearch(text)
    if (!text.trim()) { setSimAddSug([]); return }
    debounceCall('simAddSearchFn', async () => {
      const r = await fetchWithAuth(`${API}/api/costos/buscar?q=${encodeURIComponent(text)}`)
      if (r.ok) setSimAddSug(await r.json())
    })
  }

  const simAddInsumo = (ins: any) => {
    if (simInputs[ins.sku]) { setSimAddSearch(''); setSimAddSug([]); return }
    setSimInputs(prev => ({
      ...prev,
      [ins.sku]: { costo: ins.costo_unitario_clp || 0, cantidad: 0, nombre: ins.nombre, isNew: true }
    }))
    setSimAddSearch(''); setSimAddSug([])
  }

  const simRemoveInsumo = (sku: string) => {
    setSimInputs(prev => {
      const next = { ...prev }; delete next[sku]; return next
    })
  }

  const simAddLibre = () => {
    if (!simLibreNombre.trim() || simLibreCantidad <= 0) return
    const id = `_libre_${simLibreCounter.current++}`
    setSimLibreItems(prev => [...prev, {
      id,
      nombre: simLibreNombre.trim(),
      cantidad: simLibreCantidad,
      costo: simLibreCosto,
      costoUsd: simLibreCostoUsd
    }])
    setSimLibreNombre('')
    setSimLibreCantidad(0)
    setSimLibreCosto(0)
    setSimLibreCostoUsd(0)
    setSimLibreOpen(false)
  }

  const simRemoveLibre = (id: string) => {
    setSimLibreItems(prev => prev.filter(it => it.id !== id))
  }

  const updateInsumo = (i: number, field: string, val: number | string) => {
    const tc = params?.tipo_cambio_usd || 950
    const u = [...nuevaInsumos]; u[i][field] = val
    // Si cambia el CLP, recalcular USD automáticamente para insumos manuales
    if (field === 'costo_unitario_clp' && u[i].isManual) {
      u[i].costo_unitario_usd = parseFloat(val as string) / tc
    }
    u[i].costo_teorico_total_clp = u[i].cantidad_requerida_formato * (u[i].costo_unitario_clp || 0)
    u[i].costo_teorico_total_usd = u[i].cantidad_requerida_formato * (u[i].costo_unitario_usd || 0)
    setNuevaInsumos(u)
  }

  const nuevaKgEquivalente = (): number => {
    const cantidad = nuevaConfig.peso_kilos || 0
    const dens = parseFloat(nuevaDensidad) || 1
    if (nuevaUnidad === 'litro') return cantidad * dens
    if (nuevaUnidad === 'galon') return cantidad * 3.785 * dens
    return cantidad // kg o unidad: directo
  }

  const calcNueva = () => {
    const insumos = nuevaInsumos.reduce((s, r) => s + r.costo_teorico_total_clp, 0)
    const p = nuevaKgEquivalente()
    const merma = parseFloat(nuevaMermaFactor) || params?.merma_global_factor || 1
    const bomConMerma = insumos * merma
    const leyRep = (params?.ley_rep_por_kilo || 3) * p
    const disp   = (params?.disposicion_por_kilo || 2) * p
    const flete  = (params?.costo_flete_base_kilo || 87) * p
    const pallet = (params?.costo_pallet_base_kilo || 14) * p
    const ind    = bomConMerma * (params?.gastos_indirectos_porcentaje || 0.01)
    const mermaAmt = insumos * (merma - 1)
    return { insumos, mermaAmt, leyRep, disp, flete, pallet, ind, pesoKg: p, total: bomConMerma + leyRep + disp + flete + pallet + ind }
  }

  const proyectarNueva = async () => {
    const t = calcNueva()
    const body: any = { costo_base_mp: t.insumos, peso_kg: t.pesoKg || 1, moneda_simulacion: 'CLP' }
    if (nuevaMermaFactor) body.merma_factor = parseFloat(nuevaMermaFactor)
    const r = await fetchWithAuth(`${API}/api/costos/simular_nuevo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (r.ok) setSimNuevaResult(await r.json())
  }

  const saveCostoManual = async () => {
    if (!manualSku || !manualCosto) return
    setManualMsg('Guardando...')
    const r = await fetchWithAuth(`${API}/api/costos/manual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: manualSku, costo_unitario_clp: parseFloat(manualCosto), notas: manualNota, usuario: 'frontend' })
    })
    if (r.ok) {
      setManualMsg('Guardado correctamente'); setManualSku(''); setManualCosto(''); setManualNota(''); loadSinPrecio()
    } else { setManualMsg('Error: ' + (await r.json()).detail) }
  }

  const newClienteDefault: Cliente = { cliente: '', factor: 1, descuento_max: 0, comision_promedio: 0, rapell: 0, fee: 0, marketing: 0, x_docking: 0, rebate: 0, rebate_centralizacion: 0, flete_por_kilo: 0, flete_agua_kilo: 0, flete_otros_kilo: 0, pallet_agua_kilo: 0, pallet_otros_kilo: 0 }

  /* =========================================================
     LOGIN — pantalla si no hay sesión activa
  ========================================================= */
  if (!usuario) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8faf4 0%, #edf7d4 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.12)', padding: '2.5rem 2rem', width: '100%', maxWidth: 380 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img src="/logo-passol-large.jpg" alt="Passol" style={{ height: 64, objectFit: 'contain' }} />
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#84BD00', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.4rem' }}>
            Sistema de Costeo Industrial
          </div>
        </div>

        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: '#2A2B2A', textAlign: 'center' }}>
          Iniciar sesión
        </h2>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', display: 'block', marginBottom: '0.3rem' }}>Email</label>
            <input
              type="email" autoComplete="email" autoFocus required
              value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
              placeholder="usuario@passol.cl"
              style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1.5px solid #d1e8a0', borderRadius: 8, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', display: 'block', marginBottom: '0.3rem' }}>Contraseña</label>
            <input
              type="password" autoComplete="current-password" required
              value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1.5px solid #d1e8a0', borderRadius: 8, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {loginError && (
            <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: 8, padding: '0.6rem 0.75rem', color: '#dc2626', fontSize: '0.82rem' }}>
              {loginError}
            </div>
          )}

          <button type="submit" disabled={loginLoading}
            style={{ background: '#84BD00', color: '#fff', border: 'none', borderRadius: 8, padding: '0.75rem', fontWeight: 700, fontSize: '0.95rem', cursor: loginLoading ? 'not-allowed' : 'pointer', opacity: loginLoading ? 0.7 : 1, marginTop: '0.25rem' }}>
            {loginLoading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#aaa', marginTop: '1.5rem', marginBottom: 0 }}>
          ¿Olvidaste tu contraseña? Contacta al administrador.
        </p>
      </div>
    </div>
  )

  /* =========================================================
     COVER PAGE — Branding PASSOL
  ========================================================= */
  if (view === 'cover') return (
    <div style={{
      minHeight: '100vh',
      background: '#f8faf4',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Top stripe */}
      <div style={{ height: 5, background: 'linear-gradient(90deg, #84BD00 60%, #a8d400 100%)' }} />

      {/* Header */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e8f0d8',
        padding: '0 2rem',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img src="/logo-passol-topbar.jpg" alt="Passol" style={{ height: 36, objectFit: 'contain' }} />
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#84BD00', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Sistema de Costeo
          </div>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', fontWeight: 500 }}>
          Pinturas y Recubrimientos · Costeo Interno
        </div>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: 900, width: '100%' }}>

          {/* Hero text */}
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            {/* Logo principal */}
            <div style={{ marginBottom: '1.75rem' }}>
              <img src="/logo-passol-large.jpg" alt="Passol — innovando con pasión"
                style={{ height: 80, objectFit: 'contain' }} />
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              background: '#edf7d4', border: '1px solid #c3e87a', borderRadius: 20,
              padding: '4px 14px', marginBottom: '1rem',
              fontSize: '0.72rem', fontWeight: 700, color: '#5a8a00', letterSpacing: '0.06em', textTransform: 'uppercase'
            }}>
              <span>●</span> Motor BOM Multinivel
            </div>
            <h1 style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
              fontWeight: 800,
              color: '#2A2B2A',
              margin: '0 0 0.75rem',
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
            }}>
              Gestión de Costos<br />
              <span style={{ color: '#84BD00' }}>Inteligente y Precisa</span>
            </h1>
            <p style={{ color: 'var(--text-2)', fontSize: '0.95rem', maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
              Explosión de recetas multinivel, análisis de márgenes por canal y simulaciones What-If en tiempo real.
            </p>
          </div>

          {/* Module grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.85rem',
          }}>
            {[
              { icon: '📊', label: 'Consulta de Costos', sub: 'BOM multinivel · fuente de precio', view: 'consulta', primary: true },
              { icon: '⚡', label: 'Simulador What-If', sub: 'Escenarios de costo y rentabilidad', view: 'simulador', primary: true },
              { icon: '✏️', label: 'Costos Manuales', sub: 'Insumos sin historial de compra', view: 'manuales', primary: false },
              { icon: '🤝', label: 'Cadenas', sub: 'Condiciones comerciales y rebates', view: 'clientes', primary: false },
              { icon: '⚙️', label: 'Parámetros', sub: 'Fletes, REP, gastos indirectos', view: 'parametros', primary: false },
              { icon: '📥', label: 'Actualizar BD', sub: 'Ingesta desde archivo ERP', view: 'import', primary: false },
            ].map(m => (
              <button key={m.view}
                onClick={() => go(m.view as ViewState)}
                style={{
                  background: m.primary ? '#84BD00' : '#fff',
                  border: m.primary ? '1px solid #6fa000' : '1px solid #dde9c0',
                  borderRadius: 12,
                  padding: '1.1rem 1.2rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.18s',
                  boxShadow: m.primary ? '0 4px 16px rgba(132,189,0,0.3)' : '0 2px 8px rgba(0,0,0,0.05)',
                  fontFamily: "'DM Sans', sans-serif",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-3px)'
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow = m.primary
                    ? '0 8px 24px rgba(132,189,0,0.4)'
                    : '0 6px 18px rgba(0,0,0,0.1)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow = m.primary
                    ? '0 4px 16px rgba(132,189,0,0.3)'
                    : '0 2px 8px rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>{m.icon}</div>
                <div style={{
                  fontWeight: 700, fontSize: '0.88rem',
                  color: m.primary ? '#fff' : '#2A2B2A',
                  marginBottom: '0.2rem',
                }}>
                  {m.label}
                </div>
                <div style={{
                  fontSize: '0.72rem',
                  color: m.primary ? 'rgba(255,255,255,0.8)' : '#888',
                  lineHeight: 1.4,
                }}>
                  {m.sub}
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '1rem',
        fontSize: '0.7rem', color: 'var(--text-3)',
        borderTop: '1px solid #e8f0d8',
        background: '#fff',
      }}>
        Passol Pinturas · Sistema Interno de Costeo y Rentabilidad
      </footer>
    </div>
  )

  const viewLabels: Record<string, string> = {
    import: '📥 Ingesta ERP', parametros: '⚙️ Parámetros Indirectos',
    clientes: '🤝 Cadenas', consulta: '🔍 Consulta de Costos BOM',
    simulador: '⚡ Simulador de Recetas', manuales: '✏️ Costos Manuales',
    mp: '📦 Costos de Materias Primas', dashboard: '📊 Dashboard Ejecutivo',
    alertas: '🔔 Alertas de Variación', historial: '📋 Historial de Escenarios',
    admin: '👥 Administración de Usuarios',
  }

  function InfoPopover({ id, title, formula, description }: {
    id: string; title: string; formula: string; description: string
  }) {
    const isOpen = openPopover === id
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!isOpen) {
        const rect = e.currentTarget.getBoundingClientRect()
        const left = Math.min(rect.left, window.innerWidth - 292)
        const spaceBelow = window.innerHeight - rect.bottom
        const top = spaceBelow >= 160 ? rect.bottom + 6 : rect.top - 160
        setPopoverPos({ top: Math.max(8, top), left })
        setPopoverContent({ title, formula, description })
      }
      setOpenPopover(isOpen ? null : id)
    }
    return (
      <span style={{ display: 'inline-block', marginLeft: 4, verticalAlign: 'middle' }}>
        <button
          onClick={handleClick}
          style={{
            background: isOpen ? '#6fa000' : 'var(--primary)',
            border: 'none', borderRadius: '50%', cursor: 'pointer',
            color: 'white', fontSize: '0.65rem', fontWeight: 900,
            width: 15, height: 15, padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}
          title="Ver metodología"
        >i</button>
      </span>
    )
  }

  /* =========================================================
     SHELL
  ========================================================= */
  return (
    <div className="app-shell">

      {/* TOPBAR */}
      <nav className="topbar">
        <div className="topbar-brand" onClick={() => go('cover')}>
          <img src="/logo-passol-topbar.jpg" alt="Passol" style={{ height: 26, objectFit: 'contain', flexShrink: 0 }} />
          <span className="back-link" style={{ marginLeft: '0.4rem', fontSize: '0.68rem', opacity: 0.6 }}>← Inicio</span>
        </div>
        <div className="topbar-nav">
          {(['import','parametros','clientes','productos','consulta','simulador','manuales','mp','dashboard','alertas','historial'] as ViewState[])
            .filter(v => canAccess(v))
            .map(v => (
            <button key={v} className={`topbar-btn ${view === v ? 'active' : ''}`} onClick={() => go(v)}>
              {{ cover:'Inicio', admin:'👥 Usuarios', import:'BD ERP', parametros:'Parámetros', clientes:'Cadenas', productos:'Historial MP/Insumos',
                 consulta:'Costos de Productos', simulador:'Simulador', manuales:'Costos Manuales',
                 mp:'Consulta MP', dashboard:'📊 Dashboard', alertas:'🔔 Alertas', historial:'📋 Historial' }[v]}
            </button>
          ))}
          {usuario?.es_admin && (
            <button className={`topbar-btn ${view === 'admin' ? 'active' : ''}`} onClick={() => go('admin')}
              style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', marginLeft: '0.25rem', paddingLeft: '0.75rem' }}>
              👥 Usuarios
            </button>
          )}
        </div>
        {/* Usuario activo + logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginLeft: 'auto', paddingLeft: '1rem', flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {usuario?.nombre}
            {usuario?.es_admin && <span style={{ marginLeft: '0.3rem', fontSize: '0.65rem', background: '#84BD00', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Admin</span>}
          </span>
          <button onClick={handleLogout}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, color: '#fff', fontSize: '0.72rem', padding: '0.25rem 0.6rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Cerrar sesión
          </button>
        </div>
      </nav>

      <div className="page-content">

        {/* PAGE HEADER */}
        <div className="page-header">
          <h1>{viewLabels[view]}</h1>
        </div>

        {/* ===== IMPORT ===== */}
        {view === 'import' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 560 }}>
            {/* Upload card */}
            <div className="card">
              <div className="card-title">Carga de archivos ERP</div>
              <div className="upload-zone" onClick={() => document.getElementById('file-input')?.click()}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
                <div className="fw-600" style={{ marginBottom: '0.25rem' }}>
                  {file ? file.name : 'Haz clic o arrastra el archivo aquí'}
                </div>
                <div className="text-muted text-xs">Formatos: .xlsx · .xls · .xlsm · .csv</div>
                <input id="file-input" type="file" accept=".xlsx,.xls,.csv,.xlsm"
                  style={{ display: 'none' }} onChange={e => { setFile(e.target.files?.[0] || null); setUploadStatus(''); setUploadRecalculo(null) }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
                {file && <button className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setUploadStatus(''); setUploadRecalculo(null) }}>Quitar</button>}
                <button className="btn btn-primary" onClick={uploadExcel} disabled={!file}>Procesar archivo</button>
              </div>
              {uploadStatus && (
                <div className={`alert ${uploadStatus.startsWith('Error') ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                  {uploadStatus}
                </div>
              )}
              {uploadRecalculo && (
                <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.8rem', borderRadius: 6, background: uploadRecalculo.filas_eliminadas > 0 ? '#fef9c3' : '#f0fdf4', border: `1px solid ${uploadRecalculo.filas_eliminadas > 0 ? '#fde047' : '#bbf7d0'}`, fontSize: '0.82rem', color: '#374151' }}>
                  <span style={{ fontWeight: 600 }}>Recálculo automático: </span>
                  {uploadRecalculo.filas_eliminadas > 0
                    ? `Se corrigieron ${uploadRecalculo.filas_eliminadas} registros en ${uploadRecalculo.skus_afectados} SKUs con inconsistencia de moneda.`
                    : 'Sin inconsistencias de moneda detectadas.'}
                </div>
              )}
            </div>

            {/* Google Sheets sync card */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '1.3rem' }}>🟢</span>
                <div className="card-title" style={{ margin: 0 }}>Sincronizar desde Google Sheets</div>
              </div>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-2)', margin: '0 0 0.9rem 0', lineHeight: 1.5 }}>
                Importa directamente desde el Google Sheet configurado.<br />
                <span style={{ color: '#9ca3af' }}>Equivalente a subir el Excel — actualiza maestro, recetas, compras y tipo de cambio.</span>
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={sincronizarGoogleSheets} disabled={gsyncLoading}>
                  {gsyncLoading
                    ? <><span className="sk sk-line" style={{ width: 14, height: 14, borderRadius: '50%', display: 'inline-block', marginRight: 6 }} />Sincronizando...</>
                    : '🔄 Sincronizar ahora'}
                </button>
                {gsyncResult && <button className="btn btn-ghost btn-sm" onClick={() => setGsyncResult(null)}>Limpiar</button>}
              </div>
              {gsyncResult && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', borderRadius: 6,
                  background: gsyncResult.ok ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${gsyncResult.ok ? '#bbf7d0' : '#fecaca'}` }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: gsyncResult.ok ? '#166534' : '#991b1b', marginBottom: gsyncResult.ok ? '0.5rem' : 0 }}>
                    {gsyncResult.ok ? '✅ ' : '❌ '}{gsyncResult.mensaje}
                  </div>
                  {gsyncResult.ok && gsyncResult.hojas_procesadas?.length > 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#374151' }}>
                      <div style={{ marginBottom: '0.25rem' }}>
                        <strong>Hojas importadas:</strong>{' '}
                        {gsyncResult.hojas_procesadas.map((h: string) => (
                          <span key={h} className="badge badge-green" style={{ marginRight: 4 }}>{h}</span>
                        ))}
                      </div>
                      {gsyncResult.hojas_omitidas?.length > 0 && (
                        <div>
                          <strong>Omitidas:</strong>{' '}
                          {gsyncResult.hojas_omitidas.map((h: string) => (
                            <span key={h} className="badge badge-gray" style={{ marginRight: 4 }}>{h}</span>
                          ))}
                        </div>
                      )}
                      {gsyncResult.errores?.length > 0 && (
                        <div style={{ marginTop: '0.25rem', color: '#b45309' }}>
                          <strong>Advertencias:</strong> {gsyncResult.errores.join(' | ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Recalcular costos card */}
            <div className="card">
              <div className="card-title" style={{ marginBottom: '0.4rem' }}>Recalcular Costos</div>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-2)', margin: '0 0 0.9rem 0', lineHeight: 1.5 }}>
                Detecta y corrige registros con inconsistencia de moneda en el historial de compras.<br />
                <span style={{ color: '#9ca3af' }}>Se ejecuta automáticamente tras cada importación.</span>
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={recalcularCostos} disabled={recalculoLoading}>
                  {recalculoLoading ? 'Calculando...' : 'Recalcular ahora'}
                </button>
                {recalculoResult && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setRecalculoResult(null)}>Limpiar</button>
                )}
              </div>
              {recalculoResult && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ padding: '0.75rem 1rem', borderRadius: 6, background: recalculoResult.filas_eliminadas > 0 ? '#fef9c3' : '#f0fdf4', border: `1px solid ${recalculoResult.filas_eliminadas > 0 ? '#fde047' : '#bbf7d0'}` }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: recalculoResult.filas_eliminadas > 0 ? '0.5rem' : 0 }}>
                      {recalculoResult.message}
                    </div>
                    {recalculoResult.filas_eliminadas > 0 && (
                      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.4rem' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#d97706' }}>{recalculoResult.filas_eliminadas}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>registros corregidos</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#d97706' }}>{recalculoResult.skus_afectados}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>SKUs afectados</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== PARÁMETROS ===== */}
        {view === 'parametros' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 900 }}>
            {/* Header con tabs */}
            <div className="card" style={{ padding: '0' }}>
              <div style={{ padding: '1rem 1.25rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary)', marginBottom: '0.75rem' }}>
                  Parámetros Indirectos
                </div>
                <div style={{ display: 'flex', gap: 0 }}>
                  {(['globales', 'ley-rep', 'costos-manuales'] as const).map(tab => {
                    const labels: Record<string, string> = { globales: 'Globales', 'ley-rep': 'Ley REP', 'costos-manuales': 'Costos de Cotizaciones' }
                    return (
                      <button key={tab} onClick={() => setParamTab(tab)} style={{
                        background: paramTab === tab ? '#fff' : 'transparent',
                        border: 'none',
                        borderBottom: paramTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                        color: paramTab === tab ? 'var(--primary-dark)' : '#888',
                        fontWeight: paramTab === tab ? 700 : 500,
                        fontSize: '0.82rem',
                        padding: '0.5rem 1.1rem',
                        cursor: 'pointer',
                        letterSpacing: '0.01em',
                        transition: 'all 0.15s',
                      }}>{labels[tab]}</button>
                    )
                  })}
                </div>
              </div>

              {/* TAB: Globales */}
              {paramTab === 'globales' && (
                <div style={{ padding: '1.25rem' }}>
                  {editParams ? (
                    <>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                        Valores base utilizados como fallback y en el cálculo global del costo.
                      </p>

                      {/* Tarjeta tipos de cambio */}
                      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', background: 'var(--primary-light)', border: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '0.75rem' }}>
                          Tipos de Cambio
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                          {/* USD */}
                          <div className="field">
                            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Dólar USD (CLP/USD) <InfoPopover id="p-usd" title="Tipo de Cambio USD" formula="costo_usd = costo_clp / tipo_cambio_usd" description="Usado para mostrar costos en dólares en toda la aplicación. Actualizable desde Banco Central." /></span>
                              {tcFetched && <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 400 }}>Banco Central · {tcFetched.fecha}</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-dark)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface)' }}>
                              <span style={{ padding: '0 8px', fontSize: '0.82rem', color: 'var(--text-2)', background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input type="number" className="no-spin" step={1}
                                style={{ flex: 1, border: 'none', outline: 'none', padding: '0.42rem 0.65rem', fontSize: '0.82rem', background: 'transparent' }}
                                value={editParams.tipo_cambio_usd}
                                onChange={e => setEditParams({ ...editParams, tipo_cambio_usd: parseFloat(e.target.value) || 0 })} />
                            </div>
                          </div>
                          {/* EUR */}
                          <div className="field">
                            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Euro EUR (CLP/EUR)</span>
                              {tcFetched && <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 400 }}>Banco Central · {tcFetched.fecha}</span>}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-dark)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface)' }}>
                              <span style={{ padding: '0 8px', fontSize: '0.82rem', color: 'var(--text-2)', background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input type="number" className="no-spin" step={1}
                                style={{ flex: 1, border: 'none', outline: 'none', padding: '0.42rem 0.65rem', fontSize: '0.82rem', background: 'transparent' }}
                                value={editParams.tipo_cambio_eur}
                                onChange={e => setEditParams({ ...editParams, tipo_cambio_eur: parseFloat(e.target.value) || 0 })} />
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button className="btn btn-ghost btn-sm" onClick={fetchTipoCambio} disabled={tcFetching}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            {tcFetching ? 'Consultando…' : 'Actualizar desde Banco Central'}
                          </button>
                          {tcFetched && (
                            <button className="btn btn-primary btn-sm" onClick={saveTipoCambio}>
                              Guardar tipos de cambio
                            </button>
                          )}
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginLeft: 4 }}>
                            Fuente: mindicador.cl (Banco Central de Chile)
                          </span>
                        </div>
                      </div>

                      {/* Resto de parámetros */}
                      <div className="form-grid cols-2">
                        {([
                          ['Valor UF (CLP/UF)',           'valor_uf',                      1,     '$', 'p-uf',    'Valor UF (CLP/UF)',          'uf_por_formato × valor_uf = ley_rep_clp',              'Base para calcular Ley REP por formato. Actualizable desde Banco Central en la sección Tipos de Cambio.'],
                          ['Disposición (CLP/kg)',        'disposicion_por_kilo',          0.1,   '$', 'p-disp',  'Disposición por Kilo',       'disposicion = peso_kg × este_valor',                   'Costo regulatorio de disposición final por kilo producido. Se suma directo al costo final.'],
                          ['Gastos Indirectos (%)',       'gastos_indirectos_porcentaje',  0.001, '',  'p-ind',   'Gastos Indirectos',          'gtos = costo_con_merma × este_%',                      'Porcentaje sobre el costo base post-merma. Cubre estructura, administración y operación general.'],
                          ['Merma Global (factor)',       'merma_global_factor',           0.001, '',  'p-merma', 'Factor de Merma Global',     'costo_con_merma = BOM × merma_factor',                 'Multiplicador de pérdida productiva. 1.0 = sin pérdida. 1.025 = 2.5% extra. Afecta TODOS los productos.'],
                          ['Flete Base (CLP/kg)',         'costo_flete_base_kilo',         0.1,   '$', 'p-flete', 'Flete Base',                 'flete = peso_kg × este_valor',                         'Costo de flete genérico por kilo. Las cadenas pueden tener flete específico en la pestaña Clientes.'],
                          ['Ley REP Global (CLP/kg)',     'ley_rep_por_kilo',              0.01,  '$', 'p-rep',   'Ley REP Global (fallback)',  'ley_rep = peso_kg × este_valor',                       'Solo aplica cuando el SKU no tiene valor en la tabla Ley REP por SKU. Actúa como valor de respaldo.'],
                        ] as [string, string, number, string, string, string, string, string][]).map(([label, key, step, prefix, pid, ptitle, pformula, pdesc]) => (
                          <div className="field" key={key}>
                            <label>{label} <InfoPopover id={pid} title={ptitle} formula={pformula} description={pdesc} /></label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-dark)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface)' }}>
                              {prefix && <span style={{ padding: '0 8px', fontSize: '0.82rem', color: 'var(--text-2)', background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>{prefix}</span>}
                              <input type="number" className="no-spin" step={step}
                                style={{ flex: 1, border: 'none', outline: 'none', padding: '0.42rem 0.65rem', fontSize: '0.82rem', background: 'transparent' }}
                                value={(editParams as any)[key]}
                                onChange={e => setEditParams({ ...editParams, [key]: parseFloat(e.target.value) || 0 })} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button className="btn btn-primary" onClick={saveParams}>Guardar cambios</button>
                      </div>
                    </>
                  ) : <SkeletonForm fields={8} />}
                </div>
              )}

              {/* TAB: Ley REP */}
              {paramTab === 'ley-rep' && (() => {
                const formatos = Array.from(new Set(leyRepProductos.map(p => p.formato))).sort()
                const filtrados = leyRepProductos.filter(p => {
                  const matchFormato = !leyRepFiltro || p.formato === leyRepFiltro
                  const q = leyRepBusqueda.trim().toLowerCase()
                  const matchBusqueda = !q || p.sku.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
                  return matchFormato && matchBusqueda
                })
                const ufVal = editParams?.valor_uf || params?.valor_uf || 37000
                return (
                  <div style={{ padding: '1.25rem' }}>

                    {/* ── Sección CRUD Formatos UF ── */}
                    <div className="card" style={{ padding: 0, marginBottom: '1.25rem' }}>
                      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--secondary)' }}>Tabla Ley REP por Formato de Envase</span>
                          <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: 'var(--text-2)' }}>UF × Valor UF (${fmt(ufVal, 0)}) = CLP</span>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => setLeyRepAddOpen(o => !o)}>
                          {leyRepAddOpen ? '✕ Cancelar' : '+ Agregar formato'}
                        </button>
                      </div>

                      {/* Fila nueva */}
                      {leyRepAddOpen && (
                        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--primary-light)', display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div className="field" style={{ marginBottom: 0, flex: '1 1 160px' }}>
                            <label style={{ fontSize: '0.72rem' }}>Formato (ej: 1 GAL, 1/4 GAL)</label>
                            <input type="text" placeholder="1 GAL" value={leyRepNew.formato}
                              onChange={e => setLeyRepNew({ ...leyRepNew, formato: e.target.value })}
                              style={{ width: '100%', padding: '0.38rem 0.55rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                          </div>
                          <div className="field" style={{ marginBottom: 0, flex: '0 0 130px' }}>
                            <label style={{ fontSize: '0.72rem' }}>UF por formato</label>
                            <input type="number" min={0} step="0.0001" placeholder="0.0050"
                              value={leyRepNew.uf_por_formato || ''}
                              onChange={e => setLeyRepNew({ ...leyRepNew, uf_por_formato: parseFloat(e.target.value) || 0 })}
                              style={{ width: '100%', padding: '0.38rem 0.55rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem', textAlign: 'right' }} />
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-2)', paddingBottom: '0.4rem', whiteSpace: 'nowrap' }}>
                            = <strong style={{ color: 'var(--primary-dark)' }}>${fmt(leyRepNew.uf_por_formato * ufVal, 0)} CLP</strong>
                          </div>
                          <button className="btn btn-primary btn-sm"
                            disabled={!leyRepNew.formato.trim() || leyRepNew.uf_por_formato <= 0}
                            onClick={() => saveLeyRepFormato(leyRepNew)}>✓ Guardar</button>
                        </div>
                      )}

                      {/* Tabla existente */}
                      {leyRepList.length === 0 ? (
                        <div className="empty-state" style={{ padding: '1.5rem' }}>Sin formatos registrados. Agregue el primero con el botón de arriba.</div>
                      ) : (
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Formato</th>
                                <th className="num">UF por Formato</th>
                                <th className="num">CLP Equiv.</th>
                                <th style={{ width: 120 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {leyRepList.map(item => {
                                const isEditing = leyRepEdit?.id === item.id
                                const clpEquiv = (isEditing ? (leyRepEdit?.uf_por_formato || 0) : item.uf_por_formato) * ufVal
                                return (
                                  <tr key={item.id}>
                                    <td>
                                      {isEditing
                                        ? <input type="text" value={leyRepEdit!.formato}
                                            onChange={e => setLeyRepEdit({ ...leyRepEdit!, formato: e.target.value })}
                                            style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1.5px solid var(--primary)', borderRadius: 5, fontSize: '0.85rem' }} />
                                        : <span className="badge badge-gray">{item.formato}</span>}
                                    </td>
                                    <td className="num">
                                      {isEditing
                                        ? <input type="number" min={0} step="0.0001" value={leyRepEdit!.uf_por_formato}
                                            onChange={e => setLeyRepEdit({ ...leyRepEdit!, uf_por_formato: parseFloat(e.target.value) || 0 })}
                                            style={{ width: 110, padding: '0.3rem 0.5rem', border: '1.5px solid var(--primary)', borderRadius: 5, fontSize: '0.85rem', textAlign: 'right' }} />
                                        : item.uf_por_formato.toFixed(6)}
                                    </td>
                                    <td className="num" style={{ color: 'var(--primary-dark)', fontWeight: 600 }}>
                                      ${fmt(clpEquiv, 0)}
                                    </td>
                                    <td className="ctr">
                                      {isEditing ? (
                                        <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                          <button className="btn btn-primary btn-sm" onClick={() => saveLeyRepFormato(leyRepEdit!)}>✓</button>
                                          <button className="btn btn-ghost btn-sm" onClick={() => setLeyRepEdit(null)}>✕</button>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                          <button className="btn btn-ghost btn-sm" onClick={() => setLeyRepEdit({ ...item })}>✏</button>
                                          <button className="btn btn-danger btn-sm" onClick={() => deleteLeyRepFormato(item.id!)}>✕</button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* ── Sección productos por SKU ── */}
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                      Listado de productos terminados con su costo Ley REP en CLP por SKU.
                      Haz clic en el valor para modificarlo individualmente.
                    </p>

                    {/* Barra de búsqueda + Filtro por formato */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: '#fff', flex: '1 1 220px', minWidth: 180, maxWidth: 340 }}>
                        <span style={{ padding: '4px 8px', color: 'var(--text-3)', fontSize: '0.85rem' }}>🔍</span>
                        <input
                          type="text"
                          placeholder="Buscar por código o descripción..."
                          value={leyRepBusqueda}
                          onChange={e => setLeyRepBusqueda(e.target.value)}
                          style={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.82rem', padding: '4px 6px 4px 0', background: 'transparent' }}
                        />
                        {leyRepBusqueda && (
                          <button onClick={() => setLeyRepBusqueda('')}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 6px', color: 'var(--text-3)', fontSize: '0.9rem' }}>✕</button>
                        )}
                      </div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)' }}>Formato:</label>
                      <select style={{ fontSize: '0.82rem', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 4 }}
                        value={leyRepFiltro} onChange={e => setLeyRepFiltro(e.target.value)}>
                        <option value="">Todos</option>
                        {formatos.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {(leyRepFiltro || leyRepBusqueda) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setLeyRepFiltro(''); setLeyRepBusqueda('') }}>✕ Limpiar</button>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-3)' }}>
                        {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Nombre</th>
                            <th>Formato</th>
                            <th className="num">CLP Ley REP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtrados.length === 0 && (
                            <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1.5rem' }}>Sin productos</td></tr>
                          )}
                          {filtrados.map(p => {
                            const editing = leyRepEditCLP[p.sku] !== undefined
                            return (
                              <tr key={p.sku}>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-2)' }}>{p.sku}</td>
                                <td>{p.nombre}</td>
                                <td><span className="badge badge-gray">{p.formato}</span></td>
                                <td className="num">
                                  {editing ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--primary)', borderRadius: 4, overflow: 'hidden' }}>
                                        <span style={{ padding: '2px 5px', fontSize: '0.8rem', color: 'var(--text-2)', background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)' }}>$</span>
                                        <input type="number" className="no-spin" step="0.01" autoFocus
                                          style={{ width: 100, textAlign: 'right', border: 'none', padding: '2px 6px', outline: 'none' }}
                                          value={leyRepEditCLP[p.sku]}
                                          onChange={e => setLeyRepEditCLP(prev => ({ ...prev, [p.sku]: e.target.value }))}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') saveCLPSku(p.sku, leyRepEditCLP[p.sku])
                                            if (e.key === 'Escape') setLeyRepEditCLP(prev => { const n = { ...prev }; delete n[p.sku]; return n })
                                          }} />
                                      </div>
                                      <button className="btn btn-primary btn-sm" onClick={() => saveCLPSku(p.sku, leyRepEditCLP[p.sku])}>✓</button>
                                      <button className="btn btn-ghost btn-sm" onClick={() => setLeyRepEditCLP(prev => { const n = { ...prev }; delete n[p.sku]; return n })}>✕</button>
                                    </div>
                                  ) : (
                                    <span
                                      title="Clic para editar"
                                      style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 4, display: 'inline-block' }}
                                      className={p.ley_rep_clp != null ? '' : 'badge badge-yellow'}
                                      onClick={() => setLeyRepEditCLP(prev => ({ ...prev, [p.sku]: String(p.ley_rep_clp ?? '') }))}
                                    >
                                      {p.ley_rep_clp != null ? `$${fmt(p.ley_rep_clp, 2)}` : 'Sin asignar'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* TAB: Costos Manuales */}
              {paramTab === 'costos-manuales' && (
                <div style={{ padding: '1.25rem' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                    Establece costos manuales que <strong>pisan el último precio de compra</strong>. Si eliminas el override, el sistema vuelve a usar el costo de la última compra automáticamente.
                  </p>

                  {/* Buscador para agregar / editar override */}
                  <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', background: 'var(--primary-light)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--secondary)', marginBottom: '0.75rem' }}>Buscar insumo y asignar costo manual</div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                        <input type="text" placeholder="Buscar por código o nombre de insumo…"
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem' }}
                          value={cmSearch}
                          onChange={e => searchCmInsumo(e.target.value)}
                          onBlur={() => setTimeout(() => setCmSugOpen(false), 150)}
                          onFocus={() => cmResultados.length > 0 && setCmSugOpen(true)}
                          autoComplete="off" />
                        {cmSugOpen && cmResultados.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {cmResultados.map((ins, i) => (
                              <div key={i} className="autocomplete-item" onClick={() => selectCmInsumo(ins)}>
                                <span className="ac-sku">{ins.sku}</span>
                                <span className="ac-name">{ins.nombre}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '0.72rem' }}>
                                  {ins.fuente_costo === 'manual'
                                    ? <span className="badge badge-blue">Manual</span>
                                    : ins.fuente_costo === 'compra'
                                      ? <span className="badge badge-green">Compra</span>
                                      : <span className="badge badge-yellow">Sin precio</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {cmSeleccionado && (() => {
                      const calc = calcCmCostoKg()
                      return (
                        <div style={{ marginTop: '1rem', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
                          {/* Info insumo */}
                          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', color: 'var(--text-2)', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <span>Unidad: <strong>{cmSeleccionado.unidad_medida}</strong></span>
                            {cmSeleccionado.costo_compra_clp !== null && (
                              <span>Último costo compra: <strong>${fmt(cmSeleccionado.costo_compra_clp, 2)}/kg</strong></span>
                            )}
                            {cmSeleccionado.costo_manual_clp !== null && (
                              <span>Override actual: <strong style={{ color: 'var(--info)' }}>${fmt(cmSeleccionado.costo_manual_clp, 2)}/kg</strong></span>
                            )}
                          </div>
                          {/* Grid de campos: label | controles | resultado */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '0.6rem 1rem', alignItems: 'center' }}>
                            {/* Fila 1: Precio cotización */}
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Precio cotización
                            </label>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {/* Toggle CLP / USD */}
                              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-subtle)' }}>
                                {(['CLP', 'USD'] as const).map(m => (
                                  <button key={m} onClick={() => setCmMoneda(m)}
                                    style={{ padding: '5px 10px', fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                                      background: cmMoneda === m ? 'var(--primary)' : 'transparent',
                                      color: cmMoneda === m ? '#fff' : '#555' }}>
                                    {m}
                                  </button>
                                ))}
                              </div>
                              {/* Toggle Lt / Kg */}
                              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-subtle)' }}>
                                {(['Lt', 'Kg'] as const).map(u => (
                                  <button key={u} onClick={() => setCmUnidad(u)}
                                    style={{ padding: '5px 10px', fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                                      background: cmUnidad === u ? '#2563eb' : 'transparent',
                                      color: cmUnidad === u ? '#fff' : '#555' }}>
                                    {u}
                                  </button>
                                ))}
                              </div>
                              <input type="number" className="no-spin"
                                placeholder={cmMoneda === 'CLP' ? `Precio /${cmUnidad}` : `USD/${cmUnidad}`}
                                style={{ width: 120, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem' }}
                                value={cmPrecioCot}
                                onChange={e => setCmPrecioCot(e.target.value)}
                                autoFocus />
                            </div>
                            {/* Resultado CLP/kg al lado */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: calc ? 'var(--secondary)' : '#ccc',
                                padding: '6px 12px', background: '#f8faf4', borderRadius: 6, border: `1px solid ${calc ? 'var(--border)' : '#eee'}`,
                                minWidth: 120, textAlign: 'right' }}>
                                {calc ? `$${fmt(calc.clp, 2)} /kg` : '–'}
                              </div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: calc ? '#1e40af' : '#ccc',
                                padding: '6px 12px', background: '#eff6ff', borderRadius: 6, border: `1px solid ${calc ? '#bfdbfe' : '#eee'}`,
                                minWidth: 120, textAlign: 'right' }}>
                                {calc ? `USD ${calc.usd.toFixed(4)} /kg` : '–'}
                              </div>
                            </div>
                            {/* Fila 2: Densidad (siempre visible) */}
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Densidad (kg/L)
                            </label>
                            <input type="number" className="no-spin" placeholder="Ej: 1.05"
                              style={{ width: 120, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.85rem',
                                opacity: cmUnidad === 'Kg' ? 0.45 : 1 }}
                              value={cmDensidad}
                              onChange={e => setCmDensidad(e.target.value)}
                              disabled={cmUnidad === 'Kg'} />
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                              {cmUnidad === 'Kg' ? 'No aplica (precio ya es por kg)' : `costo/kg = precio/Lt ÷ densidad`}
                            </span>
                          </div>
                          {/* Botones */}
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                            <button className="btn btn-primary" onClick={saveCmCosto} disabled={!calc}>
                              Guardar override
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setCmSeleccionado(null); setCmSearch(''); setCmPrecioCot(''); setCmDensidad(''); setCmUnidad('Lt') }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )
                    })()
                    }
                  </div>

                  {/* Lista de overrides activos */}
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--secondary)', marginBottom: '0.5rem' }}>
                    Overrides activos ({cmOverrides.length})
                  </div>
                  {cmOverrides.length === 0
                    ? <div className="empty-state">No hay costos manuales configurados. Los precios se toman de las últimas compras.</div>
                    : (
                      <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
                        <table className="tbl" style={{ minWidth: 700 }}>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Nombre</th>
                              <th className="num">Precio Cotización</th>
                              <th className="num">CLP/kg</th>
                              <th className="num">USD/kg</th>
                              <th>Actualizado</th>
                              <th style={{ textAlign: 'right' }}>Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cmOverrides.map((row: any) => {
                              const tc = row.tipo_cambio_usd || 950
                              const clpKg = row.costo_unitario_clp
                              const usdKg = clpKg / tc
                              const cotVal = row.precio_cotizacion
                              const cotLabel = cotVal != null
                                ? `${row.moneda_cotizacion === 'USD' ? 'USD ' : '$'}${fmt(cotVal, 2)} /${row.unidad_cotizacion}`
                                : '—'
                              return (
                              <>
                                <tr key={row.sku} style={{ background: cmInlineEditSku === row.sku ? '#fffbeb' : undefined }}>
                                  <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{row.sku}</td>
                                  <td style={{ fontWeight: 500 }}>{row.nombre}</td>
                                  <td className="num" style={{ fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{cotLabel}</td>
                                  <td className="num" style={{ fontWeight: 700, color: 'var(--info)', whiteSpace: 'nowrap' }}>${fmt(clpKg, 2)}</td>
                                  <td className="num" style={{ fontWeight: 700, color: 'var(--info)', whiteSpace: 'nowrap' }}>{fmtUSD(usdKg, 2)}</td>
                                  <td style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{row.fecha_actualizacion ?? '—'}</td>
                                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button className="btn btn-ghost btn-sm"
                                      style={{ fontSize: '0.72rem', marginRight: 4 }}
                                      title="Editar con cotización y densidad en el panel superior"
                                      onClick={() => loadCmInPanel(row.sku)}>
                                      Editar en panel
                                    </button>
                                    <button className="btn btn-ghost btn-sm"
                                      style={{ fontSize: '0.72rem', marginRight: 4, color: cmInlineEditSku === row.sku ? '#888' : 'var(--primary-dark, #6fa000)', fontWeight: 600 }}
                                      title="Editar precio directamente en esta fila"
                                      onClick={() => {
                                        if (cmInlineEditSku === row.sku) { setCmInlineEditSku(null); setCmInlineEditVal(''); setCmInlineDensidad('') }
                                        else {
                                          const esKg = KG_UNITS.has((row.unidad_medida || '').toUpperCase().trim())
                                          setCmInlineEditSku(row.sku)
                                          setCmInlineEditVal('')
                                          setCmInlineMoneda('CLP')
                                          setCmInlineUnidad(esKg ? 'Kg' : 'Lt')
                                          setCmInlineDensidad(String(row.densidad ?? 1))
                                        }
                                      }}>
                                      {cmInlineEditSku === row.sku ? 'Cerrar' : 'Editar precio'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm"
                                      style={{ color: 'var(--danger)', fontSize: '0.72rem' }}
                                      title="Eliminar override — vuelve al precio de compra"
                                      onClick={() => confirmAction(`¿Eliminar override de "${row.nombre}"? Volverá a usar el precio de compra.`, () => deleteCmOverride(row.sku))}>
                                      Eliminar
                                    </button>
                                  </td>
                                </tr>
                                {cmInlineEditSku === row.sku && (() => {
                                  const calc = calcCmInlineCostoKg(row)
                                  return (
                                    <tr key={`${row.sku}-edit`} style={{ background: '#fffbeb' }}>
                                      <td colSpan={8} style={{ padding: '0.75rem' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '0.5rem 1rem', alignItems: 'center', maxWidth: 700 }}>
                                          {/* Fila 1: Precio cotización */}
                                          <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>Precio cotización</label>
                                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                            {/* CLP / USD */}
                                            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-subtle)' }}>
                                              {(['CLP', 'USD'] as const).map(m => (
                                                <button key={m} onClick={() => setCmInlineMoneda(m)}
                                                  style={{ padding: '4px 9px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                                                    background: cmInlineMoneda === m ? 'var(--primary)' : 'transparent',
                                                    color: cmInlineMoneda === m ? '#fff' : '#555' }}>
                                                  {m}
                                                </button>
                                              ))}
                                            </div>
                                            {/* Lt / Kg */}
                                            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-subtle)' }}>
                                              {(['Lt', 'Kg'] as const).map(u => (
                                                <button key={u} onClick={() => setCmInlineUnidad(u)}
                                                  style={{ padding: '4px 9px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                                                    background: cmInlineUnidad === u ? '#2563eb' : 'transparent',
                                                    color: cmInlineUnidad === u ? '#fff' : '#555' }}>
                                                  {u}
                                                </button>
                                              ))}
                                            </div>
                                            <input type="number" className="no-spin"
                                              placeholder={cmInlineMoneda === 'CLP' ? `Precio /${cmInlineUnidad}` : `USD/${cmInlineUnidad}`}
                                              style={{ width: 120, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: '0.85rem' }}
                                              value={cmInlineEditVal}
                                              onChange={e => setCmInlineEditVal(e.target.value)}
                                              onKeyDown={e => { if (e.key === 'Enter') saveCmInline(row.sku, row); if (e.key === 'Escape') { setCmInlineEditSku(null); setCmInlineEditVal(''); setCmInlineDensidad('') } }}
                                              autoFocus />
                                          </div>
                                          {/* Resultado al costado */}
                                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: calc ? 'var(--secondary)' : '#ccc',
                                              padding: '5px 10px', background: '#f8faf4', borderRadius: 6, border: `1px solid ${calc ? 'var(--border)' : '#eee'}`, minWidth: 110, textAlign: 'right' }}>
                                              {calc ? `$${fmt(calc.clp, 2)} /kg` : '–'}
                                            </div>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: calc ? '#1e40af' : '#ccc',
                                              padding: '5px 10px', background: '#eff6ff', borderRadius: 6, border: `1px solid ${calc ? '#bfdbfe' : '#eee'}`, minWidth: 110, textAlign: 'right' }}>
                                              {calc ? `USD ${calc.usd.toFixed(4)} /kg` : '–'}
                                            </div>
                                          </div>
                                          {/* Fila 2: Densidad */}
                                          <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', fontWeight: 600 }}>Densidad (kg/L)</label>
                                          <input type="number" className="no-spin"
                                            style={{ width: 120, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: '0.85rem',
                                              opacity: cmInlineUnidad === 'Kg' ? 0.4 : 1 }}
                                            value={cmInlineDensidad}
                                            onChange={e => setCmInlineDensidad(e.target.value)}
                                            disabled={cmInlineUnidad === 'Kg'} />
                                          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                                            {cmInlineUnidad === 'Kg' ? 'No aplica (precio ya es por kg)' : 'costo/kg = precio/Lt ÷ densidad'}
                                          </span>
                                        </div>
                                        {/* Botones */}
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                                          <button className="btn btn-primary btn-sm" onClick={() => saveCmInline(row.sku, row)} disabled={!calc}>Guardar</button>
                                          <button className="btn btn-ghost btn-sm" onClick={() => { setCmInlineEditSku(null); setCmInlineEditVal(''); setCmInlineDensidad('') }}>Cancelar</button>
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                })()}
                              </>
                            )})}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== CLIENTES ===== */}
        {view === 'clientes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card" style={{ padding: '0' }}>
              {/* Tab header */}
              <div style={{ padding: '1rem 1.25rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary)', marginBottom: '0.75rem' }}>
                  Cadenas
                </div>
                <div style={{ display: 'flex', gap: 0 }}>
                  {(['condiciones', 'flete', 'pallet', 'rentabilidad', 'sim-rent'] as const).map(tab => {
                    const labels: Record<string, string> = { condiciones: 'Condiciones comerciales cadenas', flete: 'Costo Flete × Kilo', pallet: 'Costo Pallet × Kilo', rentabilidad: 'Rentabilidad por Cadena', 'sim-rent': '⚡ Simulador Rent.' }
                    return (
                      <button key={tab} onClick={() => { setCadenasTab(tab); if (tab !== 'condiciones') loadCostoIndirectos() }} style={{
                        background: cadenasTab === tab ? '#fff' : 'transparent',
                        border: 'none',
                        borderBottom: cadenasTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                        color: cadenasTab === tab ? 'var(--primary-dark)' : '#888',
                        fontWeight: cadenasTab === tab ? 700 : 500,
                        fontSize: '0.82rem',
                        padding: '0.5rem 1.1rem',
                        cursor: 'pointer',
                        letterSpacing: '0.01em',
                        transition: 'all 0.15s',
                      }}>{labels[tab]}</button>
                    )
                  })}
                </div>
              </div>

              {/* TAB: Condiciones */}
              {cadenasTab === 'condiciones' && (
                <div style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    <button className="btn btn-primary btn-sm"
                      onClick={() => { setEditCliente(newClienteDefault); setFormStrs(clienteToStrs(newClienteDefault)) }}>+ Nueva cadena</button>
                  </div>

                  {editCliente && (
                    <div className="edit-panel">
                      <div className="ep-title">{editCliente.id ? `Editando: ${editCliente.cliente}` : 'Nueva cadena'}</div>
                      {/* Condiciones comerciales */}
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Condiciones comerciales</div>
                      <div className="form-grid cols-4" style={{ marginBottom: '0.75rem' }}>
                        {[
                          ['Nombre',       'cliente',              'text',  false],
                          ['Factor ×',     'factor',               'num',   true],
                          ['Descuento %',  'descuento_max',        'num',   true],
                          ['Comisión %',   'comision_promedio',    'num',   true],
                          ['Rapell %',     'rapell',               'num',   true],
                          ['Fee %',        'fee',                  'num',   true],
                          ['Marketing %',  'marketing',            'num',   true],
                          ['X-Docking %',  'x_docking',            'num',   true],
                          ['Rebate %',     'rebate',               'num',   true],
                          ['Rebate Cent.%','rebate_centralizacion','num',   true],
                        ].map(([lbl, key, type, isPct]) => (
                          <div className="field" key={key as string}>
                            <label>{lbl as string}</label>
                            {type === 'text'
                              ? <input type="text"
                                  value={(editCliente as any)[key as string]}
                                  onChange={e => setEditCliente({ ...editCliente, [key as string]: e.target.value })} />
                              : <input
                                  type="text" inputMode="decimal" className="no-spin"
                                  value={formStrs[key as string] ?? ''}
                                  placeholder={isPct ? '' : '0'}
                                  onChange={e => setFormStrs(prev => ({ ...prev, [key as string]: e.target.value }))}
                                  onBlur={e => { const v = parseFloat(e.target.value.replace(',', '.')); setEditCliente((prev: any) => ({ ...prev, [key as string]: isNaN(v) ? 0 : v })) }} />
                            }
                          </div>
                        ))}
                      </div>
                      {/* Costo flete por tipo de producto */}
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Costo flete × kilo (CLP)</div>
                      <div className="form-grid cols-2" style={{ marginBottom: '0.75rem', maxWidth: 400 }}>
                        {([
                          ['Pintura Base Agua', 'flete_agua_kilo'],
                          ['Otros productos',   'flete_otros_kilo'],
                        ] as [string, keyof typeof editCliente][]).map(([lbl, field]) => (
                          <div className="field" key={field}>
                            <label>{lbl}</label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                              <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input
                                type="text" inputMode="decimal" className="no-spin"
                                value={formStrs[field] ?? ''}
                                onChange={e => setFormStrs(prev => ({ ...prev, [field]: e.target.value }))}
                                onBlur={e => { const v = parseFloat(e.target.value.replace(',', '.')); setEditCliente((prev: any) => ({ ...prev, [field]: isNaN(v) ? 0 : v })) }}
                                style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Costo pallet por tipo de producto */}
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Costo pallet × kilo (CLP)</div>
                      <div className="form-grid cols-2" style={{ marginBottom: '0.75rem', maxWidth: 400 }}>
                        {([
                          ['Pintura Base Agua', 'pallet_agua_kilo'],
                          ['Otros productos',   'pallet_otros_kilo'],
                        ] as [string, keyof typeof editCliente][]).map(([lbl, field]) => (
                          <div className="field" key={field}>
                            <label>{lbl}</label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                              <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input
                                type="text" inputMode="decimal" className="no-spin"
                                value={formStrs[field] ?? ''}
                                onChange={e => setFormStrs(prev => ({ ...prev, [field]: e.target.value }))}
                                onBlur={e => { const v = parseFloat(e.target.value.replace(',', '.')); setEditCliente((prev: any) => ({ ...prev, [field]: isNaN(v) ? 0 : v })) }}
                                style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={saveCliente}>Guardar</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditCliente(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Cliente</th><th className="ctr">Factor <InfoPopover id="cl-factor" title="Factor de Precio" formula="P.Lista = Costo Final × factor" description="Multiplicador que convierte el costo en precio de lista. Factor 1.8 → precio = 180% del costo de producción." /></th><th className="ctr">Descuento <InfoPopover id="cl-desc" title="Descuento Máximo" formula="P.Final = P.Lista × (1 − descuento)" description="Descuento máximo negociado con la cadena. Se aplica al precio de lista para obtener el precio final neto." /></th>
                          <th className="ctr">Comisión <InfoPopover id="cl-com" title="Comisión de Venta" formula="comision = P.Final × comision_%" description="Porcentaje del precio final pagado como comisión de venta. Se suma al costo para calcular el margen real." /></th><th className="ctr">Plan Comercial <InfoPopover id="cl-pc" title="Plan Comercial Total" formula="PC = (rapell + fee + marketing + x_docking + rebate + centralización) × P.Final" description="Suma de todas las condiciones comerciales acordadas con la cadena como porcentaje del precio final." /></th>
                          <th className="ctr">Flete Agua</th><th className="ctr">Flete Otros</th><th className="ctr">Pallet Agua</th><th className="ctr">Pallet Otros</th><th className="ctr">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientes.map((c, i) => (
                          <tr key={i}>
                            <td><span className="fw-600">{c.cliente}</span></td>
                            <td className="ctr"><span className="badge badge-blue">{c.factor}×</span></td>
                            <td className="ctr">{pct(c.descuento_max)}</td>
                            <td className="ctr">{pct(c.comision_promedio)}</td>
                            <td className="ctr">{pct(c.fee + c.marketing + c.x_docking + c.rebate + c.rebate_centralizacion)}</td>
                            <td className="ctr">{c.flete_agua_kilo ? `$${fmt(c.flete_agua_kilo)}/kg` : <span style={{color:'#999'}}>—</span>}</td>
                            <td className="ctr">{c.flete_otros_kilo ? `$${fmt(c.flete_otros_kilo)}/kg` : <span style={{color:'#999'}}>—</span>}</td>
                            <td className="ctr">{c.pallet_agua_kilo ? `$${fmt(c.pallet_agua_kilo)}/kg` : <span style={{color:'#999'}}>—</span>}</td>
                            <td className="ctr">{c.pallet_otros_kilo ? `$${fmt(c.pallet_otros_kilo)}/kg` : <span style={{color:'#999'}}>—</span>}</td>
                            <td className="ctr" style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => { setEditCliente(c); setFormStrs(clienteToStrs(c)) }}>Editar</button>
                              {c.id && <button className="btn btn-danger btn-sm" onClick={() => deleteCliente(c.id!)}>Eliminar</button>}
                            </td>
                          </tr>
                        ))}
                        {!clientes.length && <tr><td colSpan={8}><div className="empty-state">No hay cadenas registradas</div></td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB: Flete */}
              {cadenasTab === 'flete' && (
                <div style={{ padding: '1.25rem' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                    Costo de flete por kilo según tipo de producto. <strong>Pintura Base Agua</strong> aplica a familias PINTURAS AL AGUA y LATEX. <strong>Otros productos</strong> aplica al resto.
                  </p>
                  {costoIndirectos.length === 0
                    ? <div className="empty-state">Sin clientes configurados</div>
                    : (
                      <>
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Cliente / Cadena</th>
                                <th className="num">Pintura Base Agua<br/><span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>CLP/kg</span></th>
                                <th className="num">Otros Productos<br/><span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>CLP/kg</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              {costoIndirectos.map((row, i) => (
                                <tr key={row.id}>
                                  <td style={{ fontWeight: 600 }}>{row.cliente}</td>
                                  <td className="num">
                                    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
                                      <span style={{ padding: '2px 5px', fontSize: '0.8rem', color: 'var(--text-2)', borderRight: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>$</span>
                                      <input type="number" className="no-spin" step="0.01" style={{ width: 90, textAlign: 'right', border: 'none', padding: '2px 6px', outline: 'none' }}
                                        value={row.flete_agua_kilo === 0 ? '' : row.flete_agua_kilo}
                                        onChange={e => {
                                          const updated = [...costoIndirectos]
                                          updated[i] = { ...updated[i], flete_agua_kilo: parseFloat(e.target.value) || 0 }
                                          setCostoIndirectos(updated)
                                        }} />
                                    </div>
                                  </td>
                                  <td className="num">
                                    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
                                      <span style={{ padding: '2px 5px', fontSize: '0.8rem', color: 'var(--text-2)', borderRight: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>$</span>
                                      <input type="number" className="no-spin" step="0.01" style={{ width: 90, textAlign: 'right', border: 'none', padding: '2px 6px', outline: 'none' }}
                                        value={row.flete_otros_kilo === 0 ? '' : row.flete_otros_kilo}
                                        onChange={e => {
                                          const updated = [...costoIndirectos]
                                          updated[i] = { ...updated[i], flete_otros_kilo: parseFloat(e.target.value) || 0 }
                                          setCostoIndirectos(updated)
                                        }} />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {addClienteOpen && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', padding: '0.75rem', background: 'var(--primary-light)', borderRadius: 6 }}>
                            <input type="text" placeholder="Nombre cliente / cadena" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: '0.85rem' }}
                              value={nuevoClienteNombre}
                              onChange={e => setNuevoClienteNombre(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && addClienteIndirecto()} />
                            <button className="btn btn-primary btn-sm" onClick={addClienteIndirecto}>Agregar</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setAddClienteOpen(false); setNuevoClienteNombre('') }}>Cancelar</button>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setAddClienteOpen(true) }}>+ Agregar cliente / cadena</button>
                          <button className="btn btn-primary" onClick={saveCostoIndirectos}>Guardar cambios</button>
                        </div>
                      </>
                    )
                  }
                </div>
              )}

              {/* TAB: Pallet */}
              {cadenasTab === 'pallet' && (
                <div style={{ padding: '1.25rem' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                    Costo de pallet por kilo según tipo de producto. <strong>Pintura Base Agua</strong> aplica a familias PINTURAS AL AGUA y LATEX. <strong>Otros productos</strong> aplica al resto.
                  </p>
                  {costoIndirectos.length === 0
                    ? <div className="empty-state">Sin clientes configurados</div>
                    : (
                      <>
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Cliente / Cadena</th>
                                <th className="num">Pintura Base Agua<br/><span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>CLP/kg</span></th>
                                <th className="num">Otros Productos<br/><span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-3)' }}>CLP/kg</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              {costoIndirectos.map((row, i) => (
                                <tr key={row.id}>
                                  <td style={{ fontWeight: 600 }}>{row.cliente}</td>
                                  <td className="num">
                                    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
                                      <span style={{ padding: '2px 5px', fontSize: '0.8rem', color: 'var(--text-2)', borderRight: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>$</span>
                                      <input type="number" className="no-spin" step="0.01" style={{ width: 90, textAlign: 'right', border: 'none', padding: '2px 6px', outline: 'none' }}
                                        value={row.pallet_agua_kilo === 0 ? '' : row.pallet_agua_kilo}
                                        onChange={e => {
                                          const updated = [...costoIndirectos]
                                          updated[i] = { ...updated[i], pallet_agua_kilo: parseFloat(e.target.value) || 0 }
                                          setCostoIndirectos(updated)
                                        }} />
                                    </div>
                                  </td>
                                  <td className="num">
                                    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
                                      <span style={{ padding: '2px 5px', fontSize: '0.8rem', color: 'var(--text-2)', borderRight: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>$</span>
                                      <input type="number" className="no-spin" step="0.01" style={{ width: 90, textAlign: 'right', border: 'none', padding: '2px 6px', outline: 'none' }}
                                        value={row.pallet_otros_kilo === 0 ? '' : row.pallet_otros_kilo}
                                        onChange={e => {
                                          const updated = [...costoIndirectos]
                                          updated[i] = { ...updated[i], pallet_otros_kilo: parseFloat(e.target.value) || 0 }
                                          setCostoIndirectos(updated)
                                        }} />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {addClienteOpen && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', padding: '0.75rem', background: 'var(--primary-light)', borderRadius: 6 }}>
                            <input type="text" placeholder="Nombre cliente / cadena" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: '0.85rem' }}
                              value={nuevoClienteNombre}
                              onChange={e => setNuevoClienteNombre(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && addClienteIndirecto()} />
                            <button className="btn btn-primary btn-sm" onClick={addClienteIndirecto}>Agregar</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setAddClienteOpen(false); setNuevoClienteNombre('') }}>Cancelar</button>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setAddClienteOpen(true) }}>+ Agregar cliente / cadena</button>
                          <button className="btn btn-primary" onClick={saveCostoIndirectos}>Guardar cambios</button>
                        </div>
                      </>
                    )
                  }
                </div>
              )}
              {/* TAB: Rentabilidad */}
              {cadenasTab === 'rentabilidad' && (
                <div style={{ padding: '1.25rem' }}>

                  {/* Barra superior: buscador + botón Limpiar + botón info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                    <div className="searchbar" style={{ flex: '1 1 320px', maxWidth: 520, marginBottom: 0 }}>
                      <span className="sb-label">Producto</span>
                      <div className="sb-divider" />
                      <div className="sb-input-wrap">
                        <input type="text" placeholder="Buscar por código o nombre…"
                          value={rentSearch} onChange={e => { searchRentSKU(e.target.value); acRent.reset() }}
                          onKeyDown={e => acRent.onKeyDown(e, rentSug.length, () => { const s = rentSug[acRent.idx]; if (s) loadRentabilidad(s.sku, s.nombre) })}
                          autoComplete="off" />
                        {rentSug.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {rentSug.map((s, i) => (
                              <div key={i} className={`autocomplete-item${i === acRent.idx ? ' active' : ''}`} onClick={() => loadRentabilidad(s.sku, s.nombre)}>
                                <span className="ac-sku">{s.sku}</span>
                                <span className="ac-name">{s.nombre}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {rentData && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => { setRentData(null); setRentSearch(''); setRentSug([]) }}>
                        ✕ Limpiar
                      </button>
                    )}
                    <button
                      onClick={() => setRentInfoOpen(v => !v)}
                      style={{
                        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem',
                        background: rentInfoOpen ? 'var(--primary-light)' : 'var(--bg-subtle)',
                        border: `1px solid ${rentInfoOpen ? 'var(--primary)' : '#ddd'}`,
                        borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                        fontSize: '0.78rem', fontWeight: 600,
                        color: rentInfoOpen ? 'var(--primary-dark)' : '#666',
                      }}>
                      <span>{rentInfoOpen ? '▲' : '▼'}</span>
                      ¿Cómo interpretar estos indicadores?
                    </button>
                  </div>

                  {/* Panel explicativo expandible */}
                  {rentInfoOpen && (
                    <div style={{
                      background: '#f8faf4', border: '1px solid var(--border)', borderRadius: 8,
                      padding: '1rem 1.25rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#444',
                      lineHeight: 1.6,
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
                        {([
                          { kpi: 'Margen Bruto (PLB – COGS) / PLB', color: '#16a34a', desc: 'Estándar universal. Primer filtro de rentabilidad. En pinturas e industriales se espera 25–45%. Por debajo del 20% hay señal de alerta en la estructura de costos.' },
                          { kpi: 'CM1 — NNR menos costos variables', color: 'var(--info)', desc: 'Mide si el producto cubre sus costos directos después de deducir plan comercial. Si CM1 es negativo, el producto está en pérdida antes de gastos indirectos.' },
                          { kpi: 'CM2 % (Margen Contribución 2)', color: '#7c3aed', desc: 'KPI central en consumo masivo (Unilever, P&G, Nestlé). Descuenta también gastos indirectos. ≥15% Rentable · 8–14% Ajustado · <8% Riesgo. Objetivo estratégico recomendado: ≥20%.' },
                          { kpi: 'Utilidad Neta (CLP)', color: '#0891b2', desc: 'Ganancia absoluta en pesos por unidad. Complementa al % para decisiones de volumen: un CM2 bajo con alto volumen puede ser más valioso que un CM2 alto con bajo volumen.' },
                          { kpi: 'Precio Piso (utilidad = 0)', color: '#92400e', desc: 'Precio mínimo negociable sin incurrir en pérdida. Herramienta clave para negociaciones con cadenas: le da al vendedor el límite inferior antes de la reunión comercial.' },
                          { kpi: 'Trade Spend Rate', color: '#dc2626', desc: 'Porcentaje del PLB destinado a condiciones comerciales y comisión. En Chile con grandes cadenas oscila entre 18–30%. Por encima del 25% las condiciones comerciales erosionan demasiado el margen.' },
                        ]).map(({ kpi, color, desc }) => (
                          <div key={kpi} style={{ background: '#fff', borderRadius: 6, padding: '0.6rem 0.8rem', border: '1px solid var(--border)', borderLeft: `3px solid ${color}` }}>
                            <div style={{ fontWeight: 700, fontSize: '0.78rem', color, marginBottom: '0.3rem' }}>{kpi}</div>
                            <div style={{ fontSize: '0.77rem', color: 'var(--text-2)' }}>{desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {rentLoading && <SkeletonCards n={5} />}

                  {rentData && rentData.rentabilidad_clientes?.length > 0 && (() => {
                    const clientes: any[] = rentData.rentabilidad_clientes
                    // num(): convierte cualquier valor a número seguro (null/undefined/NaN → 0)
                    const num = (v: any): number => { const n = Number(v); return isFinite(n) ? n : 0 }
                    const baseMP = num(rentData.costo_total_con_merma ?? rentData.costo_total_actual_clp)
                    const leyRep = num(rentData.ley_rep_clp)
                    const disposicion = num(rentData.disposicion_clp)
                    const gtosInd = num(rentData.gtos_indirectos_clp)

                    // Derived metrics per chain
                    const metricas = clientes.map((c: any) => {
                      const plb = num(c.precio_lista_envase)
                      const pnc = num(c.precio_final_envase)
                      const descuento = plb - pnc
                      const planCom = num(c.plan_comercial_monto)
                      const comision = num(c.comision_monto)
                      const nnr = pnc - planCom - comision
                      const flete = num(c.flete_clp)
                      const pallet = num(c.pallet_clp)
                      // Gross Margin = (PLB - COGS) / PLB
                      const grossMarginPct = plb > 0 ? (plb - baseMP) / plb * 100 : 0
                      // CM1 = NNR - COGS - logística variable (ley_rep, disposicion, flete, pallet)
                      const cm1 = nnr - baseMP - leyRep - disposicion - flete - pallet
                      const cm1Pct = nnr > 0 ? cm1 / nnr * 100 : 0
                      // CM2 = CM1 - gastos indirectos
                      const cm2 = cm1 - gtosInd
                      const cm2Pct = nnr > 0 ? cm2 / nnr * 100 : 0
                      // Precio piso: PNC mínimo donde utilidad = 0
                      const deductionRate = pnc > 0 ? (planCom + comision) / pnc : 0
                      const precioPiso = deductionRate < 1 ? num(c.costo_parcial) / (1 - deductionRate) : 0
                      // Trade Spend Rate = (plan_comercial + descuento) / PLB
                      const tradeSpendRate = plb > 0 ? (planCom + descuento) / plb * 100 : 0
                      return { ...c, plb, pnc, descuento, planCom, comision, nnr, flete, pallet, grossMarginPct, cm1, cm1Pct, cm2, cm2Pct, precioPiso, tradeSpendRate }
                    })

                    // KPI summary
                    const cm2s: number[] = metricas.map((m: any) => m.cm2Pct)
                    const validCm2s = cm2s.filter(v => isFinite(v))
                    const maxCM2 = validCm2s.length ? Math.max(...validCm2s) : 0
                    const minCM2 = validCm2s.length ? Math.min(...validCm2s) : 0
                    const avgCM2 = validCm2s.length ? validCm2s.reduce((a, b) => a + b, 0) / validCm2s.length : 0
                    const mejorCadena = metricas.find((m: any) => m.cm2Pct === maxCM2)?.cliente ?? ''
                    const peorCadena = metricas.find((m: any) => m.cm2Pct === minCM2)?.cliente ?? ''

                    const sfColor = (pct: number) => pct >= 15 ? '#16a34a' : pct >= 8 ? '#d97706' : '#dc2626'
                    const sfBg = (pct: number) => pct >= 15 ? '#f0fdf4' : pct >= 8 ? '#fffbeb' : '#fef2f2'
                    const fp = (v: number) => isFinite(v) ? `${v.toFixed(1)}%` : '–'

                    // Helper: renders a table cell with CLP + optional % below
                    const cell = (key: string, clpVal: number | undefined, pctVal: number | undefined, opts: { bold?: boolean; clpColor?: string; pctColor?: string; bg?: string } = {}) => (
                      <td key={key} className="num" style={{ fontWeight: opts.bold ? 700 : 400, background: opts.bg ?? '', verticalAlign: 'middle', padding: '5px 10px' }}>
                        {clpVal !== undefined && (
                          <div style={{ fontSize: '0.82rem', color: opts.clpColor ?? 'inherit' }}>
                            ${fmt(clpVal, 0)}
                          </div>
                        )}
                        {pctVal !== undefined && (
                          <div style={{ fontSize: '0.72rem', color: opts.pctColor ?? '#999', marginTop: clpVal !== undefined ? 1 : 0 }}>
                            {fp(pctVal)}
                          </div>
                        )}
                      </td>
                    )

                    const secHead = (label: string) => (
                      <tr>
                        <td colSpan={metricas.length + 1} style={{ background: 'var(--surface-2)', color: 'var(--secondary)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.09em', padding: '5px 10px', textTransform: 'uppercase', borderTop: '1px solid var(--border-dark)' }}>{label}</td>
                      </tr>
                    )

                    return (
                      <div>
                        {/* Product header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--secondary)' }}>
                            {rentData.sku} — {rentData.formato}
                          </span>
                          {rentData.merma_factor && rentData.merma_factor !== 1 && (
                            <span className="badge badge-yellow">Merma ×{rentData.merma_factor}</span>
                          )}
                          {rentData.peso_kilos > 0 && (
                            <span className="badge badge-gray" title={rentData.densidad > 0 ? `Densidad: ${rentData.densidad} kg/L` : ''}>
                              {fmt(rentData.peso_kilos, 3)} kg
                              {rentData.litros_formato > 0 && ` / ${fmt(rentData.litros_formato, 2)} L`}
                            </span>
                          )}
                        </div>

                        {/* KPI Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'start' }}>
                          {([
                            { label: 'MEJOR CADENA (CM2)', value: fp(maxCM2), sub: mejorCadena,                   color: '#16a34a', bg: '#f0fdf4', border: '#16a34a' },
                            { label: 'PEOR CADENA (CM2)',  value: fp(minCM2), sub: peorCadena,                    color: '#dc2626', bg: '#fef2f2', border: '#dc2626' },
                            { label: 'PROMEDIO CM2',       value: fp(avgCM2), sub: `${metricas.length} cadenas`,  color: sfColor(avgCM2), bg: '#fff', border: sfColor(avgCM2) },
                          ]).map(({ label, value, sub, color, bg, border }) => (
                            <div key={label} style={{ borderLeft: `4px solid ${border}`, background: bg, border: `1px solid ${border}20`, borderRadius: 8, padding: '0.6rem 0.8rem', textAlign: 'center' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-2)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                              <div style={{ fontWeight: 800, fontSize: '1.3rem', color }}>{value}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>
                            </div>
                          ))}
                        </div>

                        {/* Toolbar: export + scroll hint */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => {
                            const rows = metricas.map((m: any) => ({
                              'Cadena': m.cliente,
                              'Precio Lista CLP': m.plb,
                              'Precio Neto CLP': m.pnc,
                              'Descuento CLP': m.descuento,
                              'Plan Comercial CLP': m.planCom,
                              'Comisión CLP': m.comision,
                              'NNR CLP': m.nnr,
                              'Flete CLP': m.flete,
                              'Pallet CLP': m.pallet,
                              'CM1 CLP': m.cm1,
                              'CM1 %': parseFloat(m.cm1Pct?.toFixed(2)) || 0,
                              'CM2 CLP': m.cm2,
                              'CM2 %': parseFloat(m.cm2Pct?.toFixed(2)) || 0,
                              'Precio Piso CLP': m.precioPiso,
                              'Gross Margin %': parseFloat(m.grossMarginPct?.toFixed(2)) || 0,
                              'Trade Spend %': parseFloat(m.tradeSpendRate?.toFixed(2)) || 0,
                            }))
                            const sku = rentData.sku || 'SKU'
                            exportToExcel(
                              [{ name: 'Rentabilidad', data: rows }],
                              `Rentabilidad_${sku}_${new Date().toISOString().slice(0,10)}.xlsx`
                            )
                          }}>📥 Exportar Excel</button>
                          {metricas.length > 5 && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>← desplázate para ver todas las cadenas →</span>
                          )}
                        </div>

                        {/* Waterfall Table */}
                        <div className="tbl-wrap" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                          <table className="tbl" style={{ minWidth: 600 }}>
                            <thead>
                              <tr>
                                <th style={{ minWidth: 220, textAlign: 'left', fontSize: '0.75rem' }}>Métrica</th>
                                {metricas.map((m: any) => (
                                  <th key={m.cliente} className="num" style={{ minWidth: 130, background: sfBg(m.cm2Pct), verticalAlign: 'bottom', paddingBottom: 6 }}>
                                    <div style={{ fontSize: '0.82rem' }}>{m.cliente}</div>
                                    <div style={{ fontSize: '0.68rem', color: sfColor(m.cm2Pct), marginTop: 3, fontWeight: 700 }}>
                                      ● CM2: {fp(m.cm2Pct)}
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* ── CASCADA DE PRECIOS ── */}
                              {secHead('Cascada de Precios')}
                              <tr style={{ background: '#fafafa' }}>
                                <td style={{ fontSize: '0.8rem' }}>Precio Lista Bruto (PLB)<InfoPopover id="rc-plb" title="Precio Lista Bruto (PLB)" formula="PLB = Costo Final × Factor" description="Precio de lista antes de descuentos. El factor multiplica el costo de producción para establecer el precio base de venta a la cadena." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.plb, undefined, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem', color: '#dc2626' }}>(-) Descuento comercial<InfoPopover id="rc-desc" title="Descuento Comercial" formula="Descuento = PLB × descuento_max" description="Rebaja máxima negociada con la cadena. Se aplica sobre el PLB para obtener el Precio Neto Cadena (PNC)." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.descuento, m.plb > 0 ? m.descuento / m.plb * 100 : 0, { clpColor: '#dc2626', pctColor: '#dc2626' }))}
                              </tr>
                              <tr style={{ background: '#fff9e6' }}>
                                <td style={{ fontSize: '0.8rem', fontWeight: 700 }}>= PNC (Precio Neto Cadena)<InfoPopover id="rc-pnc" title="Precio Neto Cadena (PNC)" formula="PNC = PLB × (1 − descuento_max)" description="Precio real de facturación a la cadena después del descuento negociado. Base sobre la que se calculan plan comercial y comisión." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.pnc, m.plb > 0 ? m.pnc / m.plb * 100 : 0, { bold: true }))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem', color: '#dc2626' }}>(-) Plan Comercial (rappel, fee, rebate…)<InfoPopover id="rc-plancom" title="Plan Comercial" formula="PC = (rapell + fee + marketing + x_docking + rebate + centralización) × PNC" description="Suma de todas las condiciones comerciales de la cadena aplicadas sobre el PNC. Representa el gasto comercial total negociado." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.planCom, m.plb > 0 ? m.planCom / m.plb * 100 : 0, { clpColor: '#dc2626', pctColor: '#dc2626' }))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem', color: '#dc2626' }}>(-) Comisión<InfoPopover id="rc-comision" title="Comisión de Venta" formula="Comisión = PNC × comision_promedio" description="% del PNC pagado como comisión a la fuerza de ventas o intermediario. Se descuenta antes de calcular el NNR." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.comision, m.plb > 0 ? m.comision / m.plb * 100 : 0, { clpColor: '#dc2626', pctColor: '#dc2626' }))}
                              </tr>
                              <tr style={{ background: '#edf7d4', borderTop: '2px solid #c8e6a0' }}>
                                <td style={{ fontSize: '0.8rem', fontWeight: 700 }}>= NNR (Ingreso Neto Real)<InfoPopover id="rc-nnr" title="Ingreso Neto Real (NNR)" formula="NNR = PNC − Plan Comercial − Comisión" description="Ingreso real que queda en la empresa después de todas las deducciones comerciales. Es la base de referencia para calcular % de costos y márgenes." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.nnr, m.plb > 0 ? m.nnr / m.plb * 100 : 0, { bold: true }))}
                              </tr>

                              {/* ── ESTRUCTURA DE COSTOS ── */}
                              {secHead('Estructura de Costos  (% sobre NNR)')}
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>COGS + Merma (MP, Insumos, Envase)<InfoPopover id="rc-cogs" title="COGS + Merma" formula="COGS = SUM(cantidad × costo_unitario) × merma_factor" description="Costo de materias primas, insumos y packaging con pérdida productiva incluida. Proviene de la explosión BOM recursiva del producto." /></td>
                                {metricas.map((m: any) => cell(m.cliente, baseMP, m.nnr > 0 ? baseMP / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Ley REP<InfoPopover id="rc-rep" title="Ley REP" formula="REP = ley_rep_clp (SKU) o peso_kg × ley_rep_por_kilo" description="Costo de Responsabilidad Extendida del Productor. Si el SKU tiene valor específico en la tabla Ley REP, tiene prioridad sobre el valor global por kilo." /></td>
                                {metricas.map((m: any) => cell(m.cliente, leyRep, m.nnr > 0 ? leyRep / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Disposición<InfoPopover id="rc-disp" title="Disposición" formula="Disposición = peso_kg × disposicion_por_kilo" description="Costo regulatorio de disposición final del producto por kilo. Configurable en Parámetros Globales." /></td>
                                {metricas.map((m: any) => cell(m.cliente, disposicion, m.nnr > 0 ? disposicion / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Flete<InfoPopover id="rc-flete" title="Flete Logístico" formula="Flete = peso_kg × flete_agua_kilo (o flete_otros_kilo)" description="Costo de transporte por kilo según el tipo de producto de la cadena. Las pinturas al agua usan flete_agua_kilo; otros productos usan flete_otros_kilo." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.flete, m.nnr > 0 ? m.flete / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Pallet<InfoPopover id="rc-pallet" title="Costo Pallet" formula="Pallet = peso_kg × pallet_agua_kilo (o pallet_otros_kilo)" description="Costo de paletización y manipulación por kilo. Diferenciado por tipo de producto igual que el flete." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.pallet, m.nnr > 0 ? m.pallet / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Gastos Indirectos<InfoPopover id="rc-gind" title="Gastos Indirectos" formula="GI = costo_con_merma × gastos_indirectos_%" description="Overhead de estructura y operación como % del costo base post-merma. Cubre administración, finanzas y operaciones. Configurable en Parámetros Globales." /></td>
                                {metricas.map((m: any) => cell(m.cliente, gtosInd, m.nnr > 0 ? gtosInd / m.nnr * 100 : 0, {}))}
                              </tr>
                              <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                                <td style={{ fontSize: '0.8rem', fontWeight: 700 }}>= Costo Directo Total<InfoPopover id="rc-cdt" title="Costo Directo Total" formula="CDT = COGS + REP + Disposición + Flete + Pallet + GI" description="Suma de todos los costos directos e indirectos por unidad. Es el costo completo antes de comparar con el NNR para calcular márgenes." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.costo_parcial, m.nnr > 0 ? m.costo_parcial / m.nnr * 100 : 0, { bold: true }))}
                              </tr>

                              {/* ── RESULTADOS ── */}
                              {secHead('Resultados')}
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Margen Bruto (PLB − COGS) / PLB<InfoPopover id="rc-mb" title="Margen Bruto" formula="MB = (PLB − COGS) / PLB × 100" description="Margen sobre precio de lista sin considerar gastos comerciales ni logísticos. Refleja el spread entre el precio de venta y el costo de producción puro." /></td>
                                {metricas.map((m: any) => (
                                  <td key={m.cliente} className="num" style={{ fontSize: '0.82rem', fontWeight: 600, color: m.grossMarginPct >= 40 ? '#16a34a' : m.grossMarginPct >= 20 ? '#d97706' : '#dc2626' }}>
                                    {fp(m.grossMarginPct)}
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>CM1 — NNR menos costos variables<InfoPopover id="rc-cm1" title="Margen de Contribución 1 (CM1)" formula="CM1 = NNR − COGS − REP − Disposición − Flete − Pallet" description="Contribución marginal 1: NNR menos todos los costos variables directos. Indica cuánto contribuye cada unidad vendida a cubrir los gastos indirectos." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.cm1, m.cm1Pct, { clpColor: m.cm1 >= 0 ? 'inherit' : '#dc2626', pctColor: m.cm1Pct >= 0 ? '#555' : '#dc2626' }))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem', fontWeight: 700 }}>CM2 % (Margen Contribución 2)<InfoPopover id="rc-cm2" title="Margen de Contribución 2 (CM2)" formula="CM2 = (CM1 − GI) / NNR × 100" description="Indicador principal de rentabilidad por cadena. Descuenta además los gastos indirectos del CM1. ≥15% rentable · 8–14% ajustado · <8% riesgo." /></td>
                                {metricas.map((m: any) => (
                                  <td key={m.cliente} className="num" style={{ background: sfBg(m.cm2Pct), fontWeight: 800, fontSize: '0.9rem', color: sfColor(m.cm2Pct) }}>
                                    {fp(m.cm2Pct)}
                                  </td>
                                ))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Utilidad Neta (CLP)<InfoPopover id="rc-util" title="Utilidad Neta" formula="Utilidad = NNR − Costo Directo Total" description="Ganancia absoluta en pesos por unidad vendida después de descontar todos los costos. Negativo indica que la cadena opera a pérdida." /></td>
                                {metricas.map((m: any) => (
                                  <td key={m.cliente} className="num" style={{ fontSize: '0.82rem', fontWeight: 600, color: m.utilidad_final >= 0 ? '#16a34a' : '#dc2626' }}>
                                    ${fmt(m.utilidad_final, 0)}
                                  </td>
                                ))}
                              </tr>
                              <tr style={{ background: '#fefce8' }}>
                                <td style={{ fontSize: '0.8rem' }}>Precio Piso (utilidad = 0)<InfoPopover id="rc-piso" title="Precio Piso" formula="Precio Piso = Costo Directo Total" description="Precio mínimo al que se puede vender sin incurrir en pérdida. Cualquier precio de venta final por debajo de este valor genera pérdida en la cadena." /></td>
                                {metricas.map((m: any) => cell(m.cliente, m.precioPiso, undefined, { clpColor: '#92400e' }))}
                              </tr>
                              <tr>
                                <td style={{ fontSize: '0.8rem' }}>Trade Spend Rate<InfoPopover id="rc-tsr" title="Trade Spend Rate" formula="TSR = (Plan Comercial + Comisión) / PLB × 100" description="% del precio de lista destinado a condiciones comerciales y comisión. >25% indica riesgo alto de rentabilidad. Usado para comparar eficiencia por cadena." /></td>
                                {metricas.map((m: any) => (
                                  <td key={m.cliente} className="num" style={{ fontSize: '0.8rem', color: m.tradeSpendRate > 25 ? '#dc2626' : m.tradeSpendRate > 15 ? '#d97706' : '#555' }}>
                                    {fp(m.tradeSpendRate)}
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Legend */}
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-3)' }}>
                          <span><span style={{ color: '#16a34a', fontWeight: 700 }}>●</span> CM2 ≥ 15% — Rentable</span>
                          <span><span style={{ color: '#d97706', fontWeight: 700 }}>●</span> CM2 8–14% — Margen ajustado</span>
                          <span><span style={{ color: '#dc2626', fontWeight: 700 }}>●</span> CM2 &lt; 8% — Riesgo</span>
                          <span style={{ marginLeft: 'auto' }}>% Precios: sobre PLB · % Costos: sobre NNR</span>
                        </div>
                      </div>
                    )
                  })()}

                  {!rentLoading && !rentData && (
                    <div className="empty-state">Busca un producto para ver el análisis por cadena</div>
                  )}
                </div>
              )}
        {/* TAB: Simulador Rentabilidad */}
        {cadenasTab === 'sim-rent' && (
          <div style={{ padding: '1.25rem' }}>

            {/* Toggle de modo */}
            <div className="mode-tabs" style={{ marginBottom: '1.25rem' }}>
              <button className={`mode-tab${srMode === 'sku' ? ' active' : ''}`}
                onClick={() => setSrMode('sku')}>Por Producto</button>
              <button className={`mode-tab${srMode === 'masivo' ? ' active' : ''}`}
                onClick={() => { setSrMode('masivo'); if (clientes.length === 0) loadClientes(); if (masivFamilias.length === 0) loadFamilias() }}>
                Por Familia (Masivo)
              </button>
            </div>

            {/* ── MODO MASIVO ── */}
            {srMode === 'masivo' && (
              <div>
                {/* Filtros */}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
                  <div className="field" style={{ flex: '1 1 180px', margin: 0 }}>
                    <label>Familia</label>
                    <select value={srMasivFamilia} onChange={e => onSrMasivFamiliaChange(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                      <option value="">— Selecciona —</option>
                      {masivFamilias.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '1 1 180px', margin: 0 }}>
                    <label>Subfamilia</label>
                    <select value={srMasivSubfamilia} onChange={e => { setSrMasivSubfamilia(e.target.value); setSrMasivResultados([]); setSrMasivInputsLoaded(false) }}
                      style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                      <option value="">— Todas —</option>
                      {srMasivSubfamilias.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                    <label>Cadena</label>
                    <select value={srMasivCadenaId} onChange={e => { setSrMasivCadenaId(Number(e.target.value)); setSrMasivInputsLoaded(false); setSrMasivResultados([]) }}
                      style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                      <option value={0}>— Selecciona una cadena —</option>
                      {clientes.map((cl: any) => <option key={cl.id} value={cl.id}>{cl.cliente}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm"
                    disabled={!srMasivFamilia || !srMasivCadenaId}
                    onClick={loadSrMasivCondiciones}>
                    Cargar condiciones
                  </button>
                  {(srMasivFamilia || srMasivCadenaId > 0) && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setSrMasivFamilia(''); setSrMasivSubfamilia(''); setSrMasivSubfamilias([])
                        setSrMasivCadenaId(0); setSrMasivInputsLoaded(false)
                        setSrMasivInputs({}); setSrMasivInputsOrig({}); setSrMasivStrs({})
                        setSrMasivResultados([])
                      }}>
                      ✕ Limpiar filtros
                    </button>
                  )}
                </div>

                {/* Panel edición condiciones */}
                {srMasivInputsLoaded && (
                  <div className="card" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.75rem' }}>
                      Condiciones simuladas — {clientes.find((c: any) => c.id === srMasivCadenaId)?.cliente}
                    </div>
                    {/* Condiciones comerciales */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Condiciones comerciales</div>
                    <div className="form-grid cols-4" style={{ marginBottom: '0.75rem' }}>
                      {([
                        ['Factor ×',     'factor',               'srm-factor',  'Factor de Precio',          'P.Lista = Costo Parcial × factor',                              'Multiplicador que convierte el costo parcial en precio de lista. Factor 1.8 → precio = 180% del costo.'],
                        ['Descuento %',  'descuento_max',        'srm-desc',    'Descuento Máximo',          'P.Final = P.Lista × (1 − descuento)',                           'Descuento máximo negociado con la cadena. Se aplica al precio de lista para obtener el precio final neto.'],
                        ['Comisión %',   'comision_promedio',    'srm-com',     'Comisión de Venta',         'Comisión = P.Final × comision_%',                               'Porcentaje del precio final pagado como comisión a la fuerza de ventas o intermediario.'],
                        ['Rapell %',     'rapell',               'srm-rap',     'Rappel',                    'Rappel = P.Final × rapell_%',                                   'Devolución periódica acordada con la cadena en función del volumen de ventas alcanzado.'],
                        ['Fee %',        'fee',                  'srm-fee',     'Fee de Gestión',            'Fee = P.Final × fee_%',                                         'Cargo fijo de la cadena por gestión logística, administrativa o de plataforma.'],
                        ['Marketing %',  'marketing',            'srm-mkt',     'Marketing Cooperativo',     'Marketing = P.Final × marketing_%',                             'Aporte al fondo de marketing cooperativo de la cadena. Cubre publicidad en catálogos, góndolas y promociones.'],
                        ['X-Docking %',  'x_docking',            'srm-xdock',   'X-Docking',                 'X-Dock = P.Final × x_docking_%',                               'Cargo por operación de cross-docking: mercadería no almacenada, pasa directo al punto de venta.'],
                        ['Rebate %',     'rebate',               'srm-reb',     'Rebate',                    'Rebate = P.Final × rebate_%',                                   'Descuento retroactivo condicionado al cumplimiento de objetivos de compra o venta.'],
                        ['Rebate Cent.%','rebate_centralizacion','srm-rebcen',  'Rebate Centralización',     'Reb.Cent = P.Final × rebate_cent_%',                            'Rebate adicional por operar con la central de compras de la cadena en lugar de locales independientes.'],
                      ] as [string, string, string, string, string, string][]).map(([lbl, key, pid, ptitle, pformula, pdesc]) => (
                        <div className="field" key={key}>
                          <label>{lbl} <InfoPopover id={pid} title={ptitle} formula={pformula} description={pdesc} /></label>
                          <input type="text" inputMode="decimal" className="no-spin"
                            value={srMasivStrs[key] ?? ''}
                            placeholder="0"
                            onChange={e => setSrMasivStrs(p => ({ ...p, [key]: e.target.value }))}
                            onBlur={e => { const v = parseFloat(e.target.value.replace(',','.')); setSrMasivInputs((p: any) => ({ ...p, [key]: isNaN(v) ? 0 : v })) }}
                          />
                        </div>
                      ))}
                    </div>
                    {/* Flete × kilo */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Costo flete × kilo (CLP) <InfoPopover id="srm-flete-hdr" title="Costo Flete × Kilo" formula="Flete = peso_kg × flete_kilo" description="Costo de transporte logístico por kilo de producto. Se diferencia entre pinturas al agua (PINTURAS AL AGUA, LATEX) y el resto de productos." />
                    </div>
                    <div className="form-grid cols-2" style={{ marginBottom: '0.75rem', maxWidth: 400 }}>
                      {([
                        ['Pintura Base Agua', 'flete_agua_kilo'],
                        ['Otros productos',   'flete_otros_kilo'],
                      ] as [string, string][]).map(([lbl, key]) => (
                        <div className="field" key={key}>
                          <label>{lbl}</label>
                          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                            <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                            <input type="text" inputMode="decimal" className="no-spin"
                              value={srMasivStrs[key] ?? ''}
                              onChange={e => setSrMasivStrs(p => ({ ...p, [key]: e.target.value }))}
                              onBlur={e => { const v = parseFloat(e.target.value.replace(',','.')); setSrMasivInputs((p: any) => ({ ...p, [key]: isNaN(v) ? 0 : v })) }}
                              style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Pallet × kilo */}
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Costo pallet × kilo (CLP) <InfoPopover id="srm-pallet-hdr" title="Costo Pallet × Kilo" formula="Pallet = peso_kg × pallet_kilo" description="Costo de paletización y manipulación por kilo. Aplica la misma diferenciación por tipo de producto que el flete." />
                    </div>
                    <div className="form-grid cols-2" style={{ marginBottom: '0.85rem', maxWidth: 400 }}>
                      {([
                        ['Pintura Base Agua', 'pallet_agua_kilo'],
                        ['Otros productos',   'pallet_otros_kilo'],
                      ] as [string, string][]).map(([lbl, key]) => (
                        <div className="field" key={key}>
                          <label>{lbl}</label>
                          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                            <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                            <input type="text" inputMode="decimal" className="no-spin"
                              value={srMasivStrs[key] ?? ''}
                              onChange={e => setSrMasivStrs(p => ({ ...p, [key]: e.target.value }))}
                              onBlur={e => { const v = parseFloat(e.target.value.replace(',','.')); setSrMasivInputs((p: any) => ({ ...p, [key]: isNaN(v) ? 0 : v })) }}
                              style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button className="btn btn-primary" disabled={srMasivLoading}
                        onClick={simularMasivo} style={{ minWidth: 140 }}>
                        {srMasivLoading ? 'Simulando…' : '⚡ Simular todos'}
                      </button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => { setSrMasivInputs({ ...srMasivInputsOrig }); setSrMasivStrs(srMasivToStrs(srMasivInputsOrig)); setSrMasivResultados([]) }}
                        title="Vuelve a los valores originales de la cadena">
                        Cancelar
                      </button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const empty = Object.fromEntries(_condNumFields.map(k => [k, 0]))
                          setSrMasivInputs(empty); setSrMasivStrs(Object.fromEntries(_condNumFields.map(k => [k, '']))); setSrMasivResultados([])
                        }}
                        title="Limpia todos los campos a cero">
                        Limpiar
                      </button>
                    </div>
                  </div>
                )}

                {/* Resultados */}
                {srMasivResultados.length > 0 && (() => {
                  const conBom = srMasivResultados.filter(r => r.tiene_bom && r.actual && r.simulado)
                  const sinBom = srMasivResultados.filter(r => !r.tiene_bom)
                  const cadNombre = clientes.find((c: any) => c.id === srMasivCadenaId)?.cliente || ''
                  return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.75rem' }}>
                        <span className="fw-700" style={{ fontSize: '0.9rem', color: 'var(--secondary)' }}>
                          {conBom.length} productos — {srMasivFamilia}{srMasivSubfamilia ? ` / ${srMasivSubfamilia}` : ''} · {cadNombre}
                        </span>
                        {sinBom.length > 0 && <span className="badge badge-yellow">⚠ {sinBom.length} sin BOM</span>}
                      </div>
                      <div className="tbl-wrap">
                        <table className="tbl" style={{ fontSize: '0.8rem' }}>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Nombre</th>
                              <th>Subfamilia</th>
                              <th className="num">P. Final Actual <InfoPopover id="sr-pfa" title="Precio Final Actual" formula="P.Final = P.Lista × (1 − descuento_max)" description="Precio neto facturado a la cadena con las condiciones comerciales actuales registradas en el sistema." /></th>
                              <th className="num">CM2% Actual <InfoPopover id="sr-cm2a" title="CM2% Actual" formula="CM2 = NNR − COGS − REP − Disp. − Flete − Pallet − GI" description="Contribución marginal nivel 2 como % del NNR. Mide la rentabilidad real después de todos los costos directos e indirectos. Objetivo saludable: ≥ 15%." /></th>
                              <th className="num">P. Final Simulado <InfoPopover id="sr-pfs" title="Precio Final Simulado" formula="P.Final = P.Lista × (1 − descuento_sim)" description="Precio neto resultante si se aplican las condiciones comerciales modificadas en el panel de parámetros." /></th>
                              <th className="num">CM2% Simulado <InfoPopover id="sr-cm2s" title="CM2% Simulado" formula="CM2_sim = NNR_sim − costos_directos" description="Contribución marginal nivel 2 con los parámetros simulados. Compara con el CM2% actual para evaluar el impacto del cambio." /></th>
                              <th className="num">Δ CM2% <InfoPopover id="sr-delta" title="Variación CM2%" formula="Δ CM2% = CM2%_simulado − CM2%_actual" description="Diferencia absoluta en puntos porcentuales entre el CM2 simulado y el actual. Verde = mejora de rentabilidad; rojo = deterioro." /></th>
                              <th className="ctr">BOM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {conBom.map((r: any) => {
                              const delta = r.simulado.cm2_pct - r.actual.cm2_pct
                              const goodA = r.actual.cm2_pct >= 15
                              const goodS = r.simulado.cm2_pct >= 15
                              return (
                                <tr key={r.sku}>
                                  <td><span className="fw-600 text-xs" style={{ color: 'var(--primary)' }}>{r.sku}</span></td>
                                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.nombre}>{r.nombre}</td>
                                  <td className="text-xs text-muted">{r.subfamilia}</td>
                                  <td className="num">${fmt(r.actual.precio_final, 0)}</td>
                                  <td className="num fw-600" style={{ color: goodA ? 'var(--success)' : 'var(--danger)' }}>
                                    {fmt(r.actual.cm2_pct, 1)}%
                                  </td>
                                  <td className="num fw-700" style={{ color: goodS ? 'var(--success)' : 'var(--danger)' }}>
                                    ${fmt(r.simulado.precio_final, 0)}
                                  </td>
                                  <td className="num fw-700" style={{ color: goodS ? 'var(--success)' : 'var(--danger)' }}>
                                    {fmt(r.simulado.cm2_pct, 1)}%
                                  </td>
                                  <td className="num fw-700" style={{ color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : '#888' }}>
                                    {delta > 0 ? '+' : ''}{fmt(delta, 1)}%
                                  </td>
                                  <td className="ctr">
                                    {r.insumos_sin_precio > 0
                                      ? <span className="badge badge-yellow">⚠ {r.insumos_sin_precio}</span>
                                      : <span className="badge badge-green">✓</span>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()}

                {!srMasivInputsLoaded && srMasivFamilia && srMasivCadenaId > 0 && (
                  <div className="empty-state">Selecciona familia y cadena, luego haz clic en <strong>Cargar condiciones</strong> para editar los parámetros y simular.</div>
                )}
                {!srMasivFamilia && (
                  <div className="empty-state">Selecciona una familia para comenzar.</div>
                )}
              </div>
            )}

            {/* ── MODO POR PRODUCTO ── */}
            {srMode === 'sku' && <>

            {/* Búsqueda SKU */}
            <div className="searchbar" style={{ marginBottom: '1rem', maxWidth: 520 }}>
              <span className="sb-label">Producto</span>
              <div className="sb-divider" />
              <div className="sb-input-wrap">
                <input type="text" placeholder="Buscar por código o nombre…"
                  value={srSearch} onChange={e => { searchSrSku(e.target.value); acSr.reset() }}
                  onKeyDown={e => acSr.onKeyDown(e, srSug.length, () => { const s = srSug[acSr.idx]; if (s) loadSrData(s.sku, s.nombre) })}
                  autoComplete="off" />
                {srSug.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {srSug.map((s: any, i: number) => (
                      <div key={i} className={`autocomplete-item${i === acSr.idx ? ' active' : ''}`}
                        onClick={() => loadSrData(s.sku, s.nombre)}>
                        <span className="ac-sku">{s.sku}</span>
                        <span className="ac-name">{s.nombre}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {srLoading && <div className="card" style={{ padding: 0 }}><SkeletonCards n={5} /></div>}

            {srData && !srLoading && (
              <>
                {/* Info del SKU */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>
                    <strong style={{ color: 'var(--secondary)' }}>{srData.sku}</strong>
                    {' — '}Costo base: <strong>${fmt(srData.costo_total_con_merma)}</strong>
                    {srData.peso_kilos > 0 && <> · {fmt(srData.peso_kilos, 3)} kg</>}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { setSrData(null); setSrSearch(''); setSrSug([]); setSrSelected(null); setSrResult(null); setSrScenarios([]); setSrInputs({}); setSrSaveMsg(''); setSrConfirm(false) }}>
                    ✕ Limpiar
                  </button>
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
                {srSelected && (() => {
                  // Valores ACTUAL derivados de la cadena seleccionada
                  const plbA  = srSelected.precio_lista_envase
                  const pncA  = srSelected.precio_final_envase
                  const descA = plbA - pncA
                  const planA = srSelected.plan_comercial_monto
                  const comA  = srSelected.comision_monto
                  const nnrA  = pncA - planA - comA
                  const cogsA = srData.costo_total_con_merma
                  const repA  = srData.ley_rep_clp
                  const dispA = srData.disposicion_clp
                  const fleteA  = srSelected.flete_clp
                  const palletA = srSelected.pallet_clp
                  const giA   = srData.gtos_indirectos_clp
                  const cdtA  = srSelected.costo_parcial
                  const cm2A  = srSelected.mg_final_porc
                  const utilA = srSelected.utilidad_final
                  // Valores SIMULADO (solo si ya calculó)
                  const plbS  = srResult?.precio_lista ?? null
                  const pncS  = srResult?.precio_final ?? null
                  const descS = srResult ? plbS! - pncS! : null
                  const planS = srResult?.plan_comercial_monto ?? null
                  const comS  = srResult?.comision_monto ?? null
                  const nnrS  = srResult ? pncS! - planS! - comS! : null
                  const fleteS  = srResult?.flete ?? null
                  const palletS = srResult?.pallet ?? null
                  const giS   = srResult?.gtos_indirectos ?? null
                  const cdtS  = srResult?.costo_parcial ?? null
                  const cm2S  = srResult?.cm2_pct ?? null
                  const utilS = srResult?.utilidad ?? null

                  const numCol = (a: number, s: number | null, isUp?: boolean) => (
                    <td className="num" style={{ fontSize: '0.82rem', color: s !== null ? (isUp ? (s >= a ? 'var(--success)' : 'var(--danger)') : (s <= a ? 'var(--success)' : 'var(--danger)')) : '#888', fontWeight: s !== null ? 600 : 400 }}>
                      {s !== null ? `$${fmt(s, 0)}` : '—'}
                    </td>
                  )
                  const pctCol = (a: number, s: number | null, isUp?: boolean) => (
                    <td className="num" style={{ fontSize: '0.82rem', color: s !== null ? (isUp ? (s >= a ? 'var(--success)' : 'var(--danger)') : (s <= a ? 'var(--success)' : 'var(--danger)')) : '#888', fontWeight: s !== null ? 700 : 400 }}>
                      {s !== null ? `${fmt(s, 1)}%` : '—'}
                    </td>
                  )
                  const secHd = (label: string) => (
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <td colSpan={3} style={{ color: 'var(--secondary)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.3rem 0.5rem', borderTop: '1px solid var(--border-dark)' }}>{label}</td>
                    </tr>
                  )

                  return (
                  <div className="card" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span className="card-title" style={{ margin: 0 }}>Simulador — {srSelected.cliente}</span>
                    </div>

                    {/* Parámetros editables (grid compacto) */}
                    <div style={{ background: '#f8faf4', border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem', marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.6rem' }}>Parámetros editables</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem 1rem' }}>
                        {([
                          ['Factor',          'factor',               '×',  0.1,   1, false],
                          ['Descuento %',     'descuento_max',        '%',  0.1,   1, true],
                          ['Comisión %',      'comision_promedio',    '%',  0.1,   1, true],
                          ['Rapell %',        'rapell',               '%',  0.1,   1, true],
                          ['Fee %',           'fee',                  '%',  0.1,   1, true],
                          ['Marketing %',     'marketing',            '%',  0.1,   1, true],
                          ['X-Docking %',     'x_docking',            '%',  0.1,   1, true],
                          ['Rebate %',        'rebate',               '%',  0.1,   1, true],
                          ['Centraliz. %',    'rebate_centralizacion','%',  0.1,   1, true],
                          ['Flete ($/kg)',     'flete_kilo',           '$',  1,     0, false],
                          ['Pallet ($/kg)',    'pallet_kilo',          '$',  1,     0, false],
                        ] as [string, string, string, number, number, boolean][]).map(([label, key, unit, _step, _dec, isPct]) => (
                          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>{label}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <input
                                key={`${srSelected?.cliente ?? ''}-${key}`}
                                type="text" inputMode="decimal" className="no-spin"
                                defaultValue={(srInputs as any)[key] || ''}
                                placeholder={isPct ? '' : '0'}
                                onBlur={e => { const raw = e.target.value.replace(',', '.'); const v = parseFloat(raw); setSrInputs((prev: any) => ({ ...prev, [key]: isNaN(v) ? 0 : v })) }}
                                style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 4, padding: '0.2rem 0.4rem', fontSize: '0.82rem', textAlign: 'right', background: 'white' }}
                              />
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', width: 14 }}>{unit}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cascada de precios */}
                    <div className="tbl-wrap" style={{ marginBottom: '1rem' }}>
                      <table className="tbl" style={{ fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '45%' }}>Concepto</th>
                            <th className="num">Actual</th>
                            <th className="num">Simulado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {secHd('Cascada de Precios')}
                          <tr style={{ background: '#fafafa' }}>
                            <td>Precio Lista Bruto (PLB)</td>
                            <td className="num">${fmt(plbA, 0)}</td>
                            {numCol(plbA, plbS)}
                          </tr>
                          <tr>
                            <td style={{ color: '#dc2626' }}>(-) Descuento comercial</td>
                            <td className="num" style={{ color: '#dc2626' }}>${fmt(descA, 0)}</td>
                            <td className="num" style={{ color: descS !== null ? '#dc2626' : '#888' }}>{descS !== null ? `$${fmt(descS, 0)}` : '—'}</td>
                          </tr>
                          <tr style={{ background: '#fff9e6' }}>
                            <td style={{ fontWeight: 700 }}>= PNC (Precio Neto Cadena)</td>
                            <td className="num" style={{ fontWeight: 700 }}>${fmt(pncA, 0)}</td>
                            {numCol(pncA, pncS)}
                          </tr>
                          <tr>
                            <td style={{ color: '#dc2626' }}>(-) Plan Comercial</td>
                            <td className="num" style={{ color: '#dc2626' }}>${fmt(planA, 0)}</td>
                            <td className="num" style={{ color: planS !== null ? '#dc2626' : '#888' }}>{planS !== null ? `$${fmt(planS, 0)}` : '—'}</td>
                          </tr>
                          <tr>
                            <td style={{ color: '#dc2626' }}>(-) Comisión</td>
                            <td className="num" style={{ color: '#dc2626' }}>${fmt(comA, 0)}</td>
                            <td className="num" style={{ color: comS !== null ? '#dc2626' : '#888' }}>{comS !== null ? `$${fmt(comS, 0)}` : '—'}</td>
                          </tr>
                          <tr style={{ background: '#edf7d4', borderTop: '2px solid #c8e6a0' }}>
                            <td style={{ fontWeight: 700 }}>= NNR (Ingreso Neto Real)</td>
                            <td className="num" style={{ fontWeight: 700 }}>${fmt(nnrA, 0)}</td>
                            {numCol(nnrA, nnrS, true)}
                          </tr>

                          {secHd('Estructura de Costos')}
                          <tr>
                            <td>COGS + Merma</td>
                            <td className="num">${fmt(cogsA, 0)}</td>
                            <td className="num" style={{ color: 'var(--text-3)' }}>${fmt(cogsA, 0)}</td>
                          </tr>
                          <tr>
                            <td>Ley REP</td>
                            <td className="num">${fmt(repA, 0)}</td>
                            <td className="num" style={{ color: 'var(--text-3)' }}>${fmt(srResult?.ley_rep ?? repA, 0)}</td>
                          </tr>
                          <tr>
                            <td>Disposición</td>
                            <td className="num">${fmt(dispA, 0)}</td>
                            <td className="num" style={{ color: 'var(--text-3)' }}>${fmt(srResult?.disposicion ?? dispA, 0)}</td>
                          </tr>
                          <tr>
                            <td>Flete</td>
                            <td className="num">${fmt(fleteA, 0)}</td>
                            {numCol(fleteA, fleteS, false)}
                          </tr>
                          <tr>
                            <td>Pallet</td>
                            <td className="num">${fmt(palletA, 0)}</td>
                            {numCol(palletA, palletS, false)}
                          </tr>
                          <tr>
                            <td>Gastos Indirectos</td>
                            <td className="num">${fmt(giA, 0)}</td>
                            {numCol(giA, giS, false)}
                          </tr>
                          <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                            <td style={{ fontWeight: 700 }}>= Costo Directo Total</td>
                            <td className="num" style={{ fontWeight: 700 }}>${fmt(cdtA, 0)}</td>
                            {numCol(cdtA, cdtS, false)}
                          </tr>

                          {secHd('Resultados')}
                          <tr>
                            <td style={{ fontWeight: 700 }}>CM2 %</td>
                            <td className="num" style={{ fontWeight: 700, color: cm2A >= 15 ? 'var(--success)' : cm2A >= 8 ? 'var(--warning)' : 'var(--danger)' }}>{fmt(cm2A, 1)}%</td>
                            {pctCol(cm2A, cm2S, true)}
                          </tr>
                          <tr>
                            <td>Utilidad Neta (CLP)</td>
                            <td className="num" style={{ color: utilA >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>${fmt(utilA, 0)}</td>
                            {numCol(utilA, utilS, true)}
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Botones acción */}
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

                        {!srConfirm ? (
                          <button className="btn btn-ghost btn-sm" style={{ marginBottom: '0.5rem' }}
                            onClick={() => { setSrConfirm(true); setSrSaveMsg('') }}>
                            [1] Sobreescribir condiciones actuales de {srSelected.cliente}
                          </button>
                        ) : (
                          <div style={{ background: '#fff8e1', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.82rem' }}>
                            ⚠ ¿Confirmar? Esto reemplazará las condiciones actuales de <strong>{srSelected.cliente}</strong>.
                            <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
                              <button className="btn btn-primary btn-sm" onClick={guardarCondicionesSr}>Confirmar</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setSrConfirm(false)}>Cancelar</button>
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>[2] Guardar escenario:</span>
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
                  )
                })()}

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
                            <td style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>
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
            </>}
          </div>
        )}
            </div>
          </div>
        )}

        {/* ===== PRODUCTOS ===== */}
        {view === 'productos' && (
          <div className="card">
            <div className="card-title">🧪 Historial de Compra MP / Insumos</div>

            {/* ── PESTAÑA: Productos Terminados (eliminada) ── */}
            {false && (
              <>
                <div className="searchbar" style={{ marginBottom: '1rem', maxWidth: 520 }}>
                  <span className="sb-label">Producto</span>
                  <div className="sb-divider" />
                  <div className="sb-input-wrap">
                    <input type="text" placeholder="Buscar por código o nombre…"
                      value={prodSearch} onChange={e => { searchProdSku(e.target.value); acProd.reset() }}
                      onKeyDown={e => acProd.onKeyDown(e, prodSug.length, () => { const s = prodSug[acProd.idx]; if (s) selectProdSku(s.sku, s.nombre) })}
                      autoComplete="off" />
                    {prodSug.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {prodSug.map((s, i) => (
                          <div key={s.sku} className={`autocomplete-item${i === acProd.idx ? ' active' : ''}`} onClick={() => selectProdSku(s.sku, s.nombre)}>
                            <span className="ac-sku">{s.sku}</span>
                            <span className="ac-name">{s.nombre}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {prodSku && (
                  <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{prodSku}</span>
                    <span style={{ color: 'var(--text-2)' }}>{prodNombre}</span>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { setProdSku(''); setProdNombre(''); setProdSearch(''); setProdFicha(null); setProdHistorial([]); setProdSaveMsg('') }}>
                      ✕ Limpiar
                    </button>
                  </div>
                )}

                {prodLoading && <div className="tbl-wrap"><table className="tbl"><SkeletonTable rows={5} cols={4} /></table></div>}

                {prodSku && !prodLoading && (
                  <>
                    <div className="mode-tabs" style={{ marginBottom: '1rem' }}>
                      {(['ficha', 'historial'] as const).map(t => (
                        <button key={t} className={`mode-tab ${prodTab === t ? 'active' : ''}`}
                          onClick={() => setProdTab(t)}>
                          {{ ficha: 'Ficha del producto', historial: 'Historial de costos' }[t]}
                        </button>
                      ))}
                    </div>

                    {prodTab === 'ficha' && (
                      <div style={{ maxWidth: 680 }}>
                        <div className="form-grid cols-2" style={{ marginBottom: '1rem' }}>
                          <div className="field">
                            <label>Precio Venta Sugerido (CLP)</label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                              <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input type="number" className="no-spin" placeholder="0" step="1"
                                value={prodEdit.precio_venta_sugerido || ''}
                                onChange={e => setProdEdit({ ...prodEdit, precio_venta_sugerido: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                            </div>
                          </div>
                          <div className="field">
                            <label>Precio Piso (CLP)</label>
                            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 4, background: 'white', overflow: 'hidden' }}>
                              <span style={{ padding: '0 6px', color: 'var(--text-3)', fontSize: '0.85rem', borderRight: '1px solid var(--border)', background: '#f8faf4', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>$</span>
                              <input type="number" className="no-spin" placeholder="0" step="1"
                                value={prodEdit.precio_piso || ''}
                                onChange={e => setProdEdit({ ...prodEdit, precio_piso: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                style={{ border: 'none', flex: 1, padding: '0.35rem 0.5rem', background: 'transparent', outline: 'none' }} />
                            </div>
                          </div>
                          <div className="field">
                            <label>Margen Objetivo %</label>
                            <input type="number" className="no-spin" placeholder="0" step="0.1"
                              value={prodEdit.margen_objetivo_pct || ''}
                              onChange={e => setProdEdit({ ...prodEdit, margen_objetivo_pct: e.target.value === '' ? null : parseFloat(e.target.value) })} />
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

                    {prodTab === 'historial' && (
                      prodHistorial.length === 0
                        ? <div className="empty-state">Sin historial de compras para este SKU</div>
                        : (() => {
                            const esBom = prodHistorial.some((h: any) => h.insumo_sku)
                            return (
                              <>
                                {esBom && (
                                  <div style={{ marginBottom: '0.75rem', background: '#fffbeb', border: '1px solid #d97706', color: '#92400e', fontSize: '0.8rem', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                                    Este Producto Terminado no tiene compras directas registradas. Se muestra el historial de compras de sus ingredientes (BOM nivel 1).
                                  </div>
                                )}
                                <div className="tbl-wrap">
                                  <table className="tbl">
                                    <thead>
                                      <tr>
                                        <th>Fecha</th>
                                        {esBom && <th>Insumo</th>}
                                        <th className="num">Costo CLP</th>
                                        <th className="num">Costo USD</th>
                                        <th>Fuente</th>
                                        <th>Proveedor</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(() => {
                                        const groups = new Map<string, any>()
                                        prodHistorial.forEach((h: any) => {
                                          const key = `${h.fecha}|${h.insumo_sku || ''}|${h.proveedor || ''}`
                                          const prev = groups.get(key)
                                          if (!prev || h.costo_unitario_clp > prev.costo_unitario_clp) groups.set(key, h)
                                        })
                                        return Array.from(groups.entries()).map(([key, h]) => (
                                          <tr key={`pt-${key}`}>
                                            <td>{h.fecha}</td>
                                            {esBom && (
                                              <td style={{ fontSize: '0.78rem' }}>
                                                <span style={{ fontWeight: 600 }}>{h.insumo_sku}</span>
                                                {h.insumo_nombre && <span style={{ color: 'var(--text-2)', marginLeft: '0.4rem' }}>{h.insumo_nombre}</span>}
                                              </td>
                                            )}
                                            <td className="num fw-600">{fmtCLP(h.costo_unitario_clp, 2)}</td>
                                            <td className="num" style={{ color: 'var(--info)' }}>{fmtUSD(h.costo_unitario_usd, 4)}</td>
                                            <td><span className={`badge ${h.fuente === 'compra' ? 'badge-green' : 'badge-blue'}`}>{h.fuente}</span></td>
                                            <td style={{ color: 'var(--text-2)' }}>{h.proveedor || '—'}</td>
                                          </tr>
                                        ))
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )
                          })()
                    )}
                  </>
                )}

                {!prodSku && !prodLoading && (
                  <div className="empty-state">Busca un Producto Terminado para ver su ficha e historial</div>
                )}
              </>
            )}

            {/* ── Historial de Compra MP / Insumos ── */}
            {true && (
              <>
                <div className="searchbar" style={{ marginBottom: '1rem', maxWidth: 520 }}>
                  <span className="sb-label">Insumo</span>
                  <div className="sb-divider" />
                  <div className="sb-input-wrap">
                    <input type="text" placeholder="Buscar por código o nombre…"
                      value={insSearch} onChange={e => { searchInsSku(e.target.value); acIns.reset() }}
                      onKeyDown={e => acIns.onKeyDown(e, insSug.length, () => { const s = insSug[acIns.idx]; if (s) selectInsSku(s.sku, s.nombre) })}
                      autoComplete="off" />
                    {insSug.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {insSug.map((s, i) => (
                          <div key={s.sku} className={`autocomplete-item${i === acIns.idx ? ' active' : ''}`} onClick={() => selectInsSku(s.sku, s.nombre)}>
                            <span className="ac-sku">{s.sku}</span>
                            <span className="ac-name">{s.nombre}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {insSku && (
                  <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-blue">Insumo</span>
                    <span style={{ fontWeight: 700 }}>{insSku}</span>
                    <span style={{ color: 'var(--text-2)' }}>{insNombre}</span>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { setInsSku(''); setInsNombre(''); setInsSearch(''); setInsHistorial([]) }}>
                      ✕ Limpiar
                    </button>
                  </div>
                )}

                {insLoading && <div className="tbl-wrap"><table className="tbl"><SkeletonTable rows={5} cols={4} /></table></div>}

                {insSku && !insLoading && (
                  insHistorial.length === 0
                    ? <div className="empty-state">Sin historial de compras para este insumo</div>
                    : (() => {
                        // Deduplicar
                        const groups = new Map<string, any>()
                        insHistorial.forEach((h: any) => {
                          const key = `${h.fecha}|${h.proveedor || ''}`
                          const prev = groups.get(key)
                          if (!prev || h.costo_unitario_clp > prev.costo_unitario_clp) groups.set(key, h)
                        })
                        const allRows = Array.from(groups.values()).sort((a, b) => b.fecha.localeCompare(a.fecha))

                        // Filtrar por rango de fechas
                        const filtradas = allRows.filter(h => {
                          if (insFechaDesde && h.fecha < insFechaDesde) return false
                          if (insFechaHasta && h.fecha > insFechaHasta) return false
                          return true
                        })

                        return (
                          <>
                            {/* Filtro de fechas */}
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Desde</label>
                                <input type="date" value={insFechaDesde} onChange={e => setInsFechaDesde(e.target.value)}
                                  style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: '0.82rem' }} />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Hasta</label>
                                <input type="date" value={insFechaHasta} onChange={e => setInsFechaHasta(e.target.value)}
                                  style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: '0.82rem' }} />
                              </div>
                              {(insFechaDesde || insFechaHasta) && (
                                <button className="btn btn-ghost btn-sm" onClick={() => { setInsFechaDesde(''); setInsFechaHasta('') }}>
                                  ✕ Limpiar filtro
                                </button>
                              )}
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginLeft: 'auto' }}>
                                {filtradas.length} de {allRows.length} registros
                              </span>
                            </div>

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
                                  {filtradas.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1.5rem' }}>Sin registros en el rango seleccionado</td></tr>
                                  )}
                                  {filtradas.map((h, i) => (
                                    <tr key={i}>
                                      <td>{h.fecha}</td>
                                      <td className="num fw-600">{fmtCLP(h.costo_unitario_clp, 2)}</td>
                                      <td className="num" style={{ color: 'var(--info)' }}>{fmtUSD(h.costo_unitario_usd, 4)}</td>
                                      <td><span className={`badge ${h.fuente === 'compra' ? 'badge-green' : 'badge-blue'}`}>{h.fuente}</span></td>
                                      <td style={{ color: 'var(--text-2)' }}>{h.proveedor || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )
                      })()
                )}

                {!insSku && !insLoading && (
                  <div className="empty-state">Busca un insumo o materia prima para ver su historial de compras</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== CONSULTA ===== */}
        {view === 'consulta' && (
          <>
            {/* Tabs modo consulta */}
            <div className="mode-tabs" style={{ marginBottom: '1rem' }}>
              <button className={`mode-tab${consultaMode === 'sku' ? ' active' : ''}`}
                onClick={() => setConsultaMode('sku')}>🔍 Por SKU</button>
              <button className={`mode-tab${consultaMode === 'masivo' ? ' active' : ''}`}
                onClick={() => { setConsultaMode('masivo'); if (masivFamilias.length === 0) loadFamilias() }}>
                📊 Consulta Masiva
              </button>
              <button className={`mode-tab${consultaMode === 'cadenas' ? ' active' : ''}`}
                onClick={() => { setConsultaMode('cadenas'); if (masivFamilias.length === 0) loadFamilias() }}>
                🏪 Costos por Cadena
              </button>
              <button className={`mode-tab${consultaMode === 'base' ? ' active' : ''}`}
                onClick={() => setConsultaMode('base')}>
                🎯 Simulador desde Costo Base
              </button>
            </div>

            {/* ── MODO POR SKU ── */}
            {consultaMode === 'sku' && (
              <>
                <div className="searchbar" style={{ marginBottom: '0.75rem', maxWidth: 860 }}>
                  <span className="sb-label">Producto Terminado</span>
                  <div className="sb-divider" />
                  <div className="sb-input-wrap">
                    <input type="text" placeholder="Buscar por código o nombre…" value={cSearch}
                      onChange={e => { searchCPT(e.target.value); acConsulta.reset() }}
                      onKeyDown={e => acConsulta.onKeyDown(e, cSug.length, () => { const pt = cSug[acConsulta.idx]; if (pt) selectCPT(pt.sku, pt.nombre) })}
                      autoComplete="off" />
                    {cSug.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {cSug.map((pt, i) => (
                          <div key={i} className={`autocomplete-item${i === acConsulta.idx ? ' active' : ''}`} onClick={() => selectCPT(pt.sku, pt.nombre)}>
                            <span className="ac-sku">{pt.sku}</span>
                            <span className="ac-name">{pt.nombre}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => loadCExplosion()}>Buscar</button>
                  <button className="btn btn-ghost btn-sm" disabled={!cExplosion && !cSearch} onClick={clearCExplosion}>✕ Limpiar</button>
                </div>

                {cExplosion && !cExplosion.detail && (
                  <div className="card" style={{ maxWidth: 1100 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <div>
                        <div className="fw-700" style={{ fontSize: '0.95rem', color: 'var(--secondary)' }}>📦 {cExplosion.sku}</div>
                        <div className="text-muted text-xs" style={{ marginTop: '2px' }}>Explosión BOM completa · todos los niveles</div>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => exportBomToExcel(cExplosion.sku, cNombre || cExplosion.nombre || '', cExplosion)}>📥 Exportar Excel</button>
                      <div className="stat-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                        {cExplosion.densidad > 0 && <div className="stat-box"><span className="stat-label">Densidad</span><span className="stat-value">{fmt(cExplosion.densidad, 3)} kg/L</span></div>}
                        {cExplosion.peso_kilos > 0 && <div className="stat-box"><span className="stat-label">Kilos</span><span className="stat-value">{fmt(cExplosion.peso_kilos, 3)} kg</span></div>}
                        {cExplosion.litros_formato > 0 && <div className="stat-box"><span className="stat-label">Litros</span><span className="stat-value">{fmt(cExplosion.litros_formato, 3)} L</span></div>}
                        <div className="stat-box">
                          <span className="stat-label">Costo MP <InfoPopover id="c-mp" title="Costo Materias Primas" formula="SUM(cantidad × costo_unitario) — familias MP" description="Suma de todos los insumos que no son packaging (MP base) de la explosión BOM recursiva. Precio tomado del último costo de compra o costo manual." /></span>
                          <span className="stat-value">${fmt(cExplosion.costo_mp_clp)}</span>
                        </div>
                        <div className="stat-box warning">
                          <span className="stat-label">Costo Insumos <InfoPopover id="c-ins" title="Costo Packaging" formula="SUM(cantidad × costo_unitario) — envases/tapas/etiquetas/cajas" description="Material de empaque del formato. Se separa de materias primas para análisis diferenciado de costos." /></span>
                          <span className="stat-value">${fmt(cExplosion.costo_insumos_clp)}</span>
                        </div>
                        {cExplosion.merma_factor > 1 && (
                          <div className="stat-box" style={{ borderLeft: '3px solid #f59e0b' }}>
                            <span className="stat-label">Merma ({((cExplosion.merma_factor - 1) * 100).toFixed(1)}%) <InfoPopover id="c-merma" title="Merma Global de Producción" formula="BOM × (merma_factor − 1)" description="Pérdida esperada en el proceso productivo. Un factor de 1.025 significa un 2.5% extra de material consumido. Se configura en Parámetros Globales." /></span>
                            <span className="stat-value">${fmt((cExplosion.costo_mp_clp + cExplosion.costo_insumos_clp) * (cExplosion.merma_factor - 1))}</span>
                          </div>
                        )}
                        <div className="stat-box">
                          <span className="stat-label">Gastos Adic. <InfoPopover id="c-gtos" title="Gastos Adicionales de Producción" formula="Flete + Pallet + Ley REP + Disposición + G.Indirectos" description="Costos adicionales de producción incluidos en el Costo Final. Incluye flete y pallet base. En rentabilidad por cadena se usan tarifas específicas por cliente." /></span>
                          <span className="stat-value">${fmt((cExplosion.flete_clp || 0) + (cExplosion.pallet_clp || 0) + cExplosion.ley_rep_clp + cExplosion.disposicion_clp + cExplosion.gtos_indirectos_clp)}</span>
                        </div>
                        <div className="stat-box primary">
                          <span className="stat-label">Costo Final <InfoPopover id="c-final" title="Costo Final de Producción" formula="(MP + Insumos) × merma_factor + Flete + Pallet + Ley REP + Disposición + G.Indirectos" description="Costo de producción completo incluyendo flete y pallet base. En rentabilidad por cadena se reemplazan por las tarifas específicas de cada cliente." /></span>
                          <span className="stat-value">${fmt(cExplosion.costo_final_clp)}</span>
                        </div>
                      </div>
                    </div>
                    <hr className="divider" />

                    {/* Indicador de insumos sin precio */}
                    {(() => {
                      const sinPrecio = (cExplosion.detalle_insumos || []).filter((ins: any) => ins.fuente_costo === 'sin_precio')
                      if (sinPrecio.length === 0) return null
                      return (
                        <div style={{
                          background: '#fff7ed', border: '1px solid #f59e0b', borderRadius: 8,
                          padding: '0.65rem 0.9rem', marginBottom: '0.75rem',
                          display: 'flex', gap: '0.75rem', alignItems: 'flex-start'
                        }}>
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⚠️</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#92400e', marginBottom: '0.3rem' }}>
                              {sinPrecio.length} insumo{sinPrecio.length > 1 ? 's' : ''} sin precio — el costo calculado está incompleto
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                              {sinPrecio.map((ins: any) => (
                                <span key={ins.insumo_final} title={ins.nombre_insumo}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                                    background: '#fef3c7', border: '1px solid #fcd34d',
                                    borderRadius: 4, padding: '2px 7px', fontSize: '0.75rem', color: '#78350f' }}>
                                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ins.insumo_final}</span>
                                  <span style={{ color: '#a16207', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.nombre_insumo}</span>
                                </span>
                              ))}
                            </div>
                            <div style={{ marginTop: '0.4rem', fontSize: '0.73rem', color: '#b45309' }}>
                              Asigna precios en <strong>Costos Manuales</strong> o importa compras con <strong>Actualizar BD</strong>.
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Código</th><th>Materia Prima</th>
                            <th className="num">Cantidad</th>
                            <th className="num">Unit. CLP</th><th className="num">Unit. USD</th>
                            <th className="ctr">Fuente</th>
                            <th className="num">Sub. CLP</th><th className="num">Sub. USD</th>
                          </tr>
                        </thead>
                        <tbody>
                          <TablaInsumos insumos={cExplosion.detalle_insumos || []} />
                        </tbody>
                      </table>
                    </div>

                    {/* Desglose de gastos adicionales */}
                    {(() => {
                      const bom = cExplosion.costo_mp_clp + cExplosion.costo_insumos_clp
                      const mermaFactor = cExplosion.merma_factor || 1
                      const mermaAmt = bom * (mermaFactor - 1)
                      const tc = cExplosion.tipo_cambio_usd || 950
                      const flete = cExplosion.flete_clp || 0
                      const pallet = cExplosion.pallet_clp || 0
                      const leyRep = cExplosion.ley_rep_clp || 0
                      const disp = cExplosion.disposicion_clp || 0
                      const gtos = cExplosion.gtos_indirectos_clp || 0
                      const total = mermaAmt + flete + pallet + leyRep + disp + gtos
                      const rows: Array<{ label: React.ReactNode; clp: number; color: string }> = [
                        ...(mermaAmt > 0 ? [{
                          label: (<><span>Merma global (×{mermaFactor})</span><InfoPopover id="g-merma" title="Merma Global" formula="BOM × (merma_factor − 1)" description="Pérdida de material en producción. Factor configurable en Parámetros Globales. 1.025 = 2.5% adicional sobre el costo BOM." /></>),
                          clp: mermaAmt, color: '#d97706'
                        }] : []),
                        { label: (<><span>Flete</span><InfoPopover id="g-flete" title="Costo de Flete" formula="peso_kg × costo_flete_base_kilo" description="Flete genérico por peso del formato. En rentabilidad por cadena se usa el flete específico negociado con cada cliente." /></>), clp: flete, color: 'var(--text-2)' },
                        { label: (<><span>Pallet</span><InfoPopover id="g-pallet" title="Costo de Pallet" formula="peso_kg × costo_pallet_base_kilo" description="Costo de paletización base por peso del formato. En rentabilidad por cadena se usa la tarifa específica por cliente." /></>), clp: pallet, color: 'var(--text-2)' },
                        { label: (<><span>Ley REP</span><InfoPopover id="g-rep" title="Ley REP" formula="ley_rep_clp (SKU) · o · peso_kg × ley_rep_por_kilo" description="Ley de Responsabilidad Extendida del Productor. Si el SKU tiene valor asignado en la tabla Ley REP tiene prioridad; si no, aplica el valor global por kilo." /></>), clp: leyRep, color: 'var(--text-2)' },
                        { label: (<><span>Disposición</span><InfoPopover id="g-disp" title="Costo de Disposición" formula="peso_kg × disposicion_por_kilo" description="Costo regulatorio de disposición final del producto. Se aplica por kilo producido según parámetro global." /></>), clp: disp, color: 'var(--text-2)' },
                        { label: (<><span>Gastos Indirectos</span><InfoPopover id="g-ind" title="Gastos Indirectos" formula="costo_con_merma × gastos_indirectos_%" description="Gastos de estructura y operación como porcentaje del costo base (después de aplicar merma). Se configura en Parámetros Globales." /></>), clp: gtos, color: 'var(--text-2)' },
                      ]
                      return (
                        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Gastos Adicionales
                          </div>
                          <table className="tbl" style={{ fontSize: '0.82rem' }}>
                            <thead>
                              <tr>
                                <th>Concepto</th>
                                <th className="num">CLP</th>
                                <th className="num">USD</th>
                                <th className="num">% s/ Costo Final</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, ri) => (
                                <tr key={ri}>
                                  <td style={{ color: r.color, fontWeight: r.color !== '#555' ? 600 : 400 }}>{r.label}</td>
                                  <td className="num">${fmt(r.clp, 2)}</td>
                                  <td className="num" style={{ color: '#6b7280' }}>{(r.clp / tc).toFixed(2)}</td>
                                  <td className="num" style={{ color: '#6b7280' }}>{cExplosion.costo_final_clp > 0 ? ((r.clp / cExplosion.costo_final_clp) * 100).toFixed(1) + '%' : '—'}</td>
                                </tr>
                              ))}
                              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)', background: '#f8faf4' }}>
                                <td>Total gastos</td>
                                <td className="num">${fmt(total, 2)}</td>
                                <td className="num" style={{ color: '#6b7280' }}>{(total / tc).toFixed(2)}</td>
                                <td className="num" style={{ color: '#6b7280' }}>{cExplosion.costo_final_clp > 0 ? ((total / cExplosion.costo_final_clp) * 100).toFixed(1) + '%' : '—'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                )}
                {/* ── Panel Precio de Venta ── */}
                {cExplosion && !cExplosion.detail && cExplosion.costo_final_clp > 0 && (() => {
                  const margenNum  = parseFloat(pvMargen.replace(',', '.')) || 0
                  const absAj      = parseFloat(pvAjuste.replace(',', '.')) || 0
                  const ajusteNum  = pvAjusteSign === '-' ? -absAj : absAj
                  const costoBase  = cExplosion.costo_final_clp
                  const pvCalc     = costoBase * (1 + margenNum / 100)
                  const pfCalc     = pvCalc * (1 + ajusteNum / 100)
                  const tc         = cExplosion.tipo_cambio_usd || 950
                  const hayAjuste  = ajusteNum !== 0
                  return (
                    <div className="card" style={{ maxWidth: 860, marginTop: '1rem', border: cExplosion.pv_activo ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                        <span className="card-title" style={{ margin: 0 }}>Precio de Venta</span>
                        {cExplosion.pv_activo && <span className="badge badge-green">Override activo</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                        {/* Costo base */}
                        <div className="stat-box" style={{ margin: 0 }}>
                          <span className="stat-label">Costo Final (base)</span>
                          <span className="stat-value">${fmt(costoBase)}</span>
                        </div>
                        {/* Margen input */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Margen %</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="text" inputMode="decimal"
                              value={pvMargen} placeholder="0"
                              onChange={e => { setPvMargen(e.target.value); setPvSaveMsg('') }}
                              style={{ width: 80, border: '1px solid var(--border)', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.9rem', textAlign: 'right' }} />
                            <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>%</span>
                          </div>
                        </div>
                        {/* Precio de venta calculado */}
                        <div className={`stat-box${margenNum !== 0 ? ' primary' : ''}`} style={{ margin: 0 }}>
                          <span className="stat-label">Precio de Venta</span>
                          <span className="stat-value">${fmt(pvCalc)}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>${(pvCalc / tc).toFixed(2)} USD</span>
                        </div>
                        {/* Ajuste adicional con botones ▲▼ */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ajuste % s/ P. Venta</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                              <button onClick={() => setPvAjusteSign('+')}
                                style={{ padding: '0.3rem 0.55rem', background: pvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: pvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                                ▲ Subir
                              </button>
                              <button onClick={() => setPvAjusteSign('-')}
                                style={{ padding: '0.3rem 0.55rem', background: pvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: pvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                                ▼ Bajar
                              </button>
                            </div>
                            <input type="text" inputMode="decimal"
                              value={pvAjuste} placeholder="0"
                              onChange={e => { setPvAjuste(e.target.value.replace('-', '')); setPvSaveMsg('') }}
                              style={{ width: 64, border: '1px solid var(--border)', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.9rem', textAlign: 'right' }} />
                            <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>%</span>
                          </div>
                        </div>
                        {/* Precio final ajustado */}
                        {hayAjuste && (
                          <div className="stat-box warning" style={{ margin: 0 }}>
                            <span className="stat-label">Precio Final Ajustado</span>
                            <span className="stat-value">${fmt(pfCalc)}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>${(pfCalc / tc).toFixed(2)} USD</span>
                          </div>
                        )}
                      </div>
                      {/* Override activo: muestra valores guardados */}
                      {cExplosion.pv_activo && (
                        <div style={{ background: '#edf7d4', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#4a7c00' }}>
                          Override guardado: P. Venta = <strong>${fmt(cExplosion.pv_precio_venta)}</strong>
                          {cExplosion.pv_ajuste_pct !== 0 && <> → Ajustado = <strong>${fmt(cExplosion.pv_precio_final)}</strong></>}
                          {' '}— usado como base en todas las vistas de cadenas
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button className="btn btn-primary btn-sm" onClick={savePrecioVenta} disabled={pvSaving || !pvMargen}>
                          {pvSaving ? 'Guardando…' : 'Grabar'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          const aj = cExplosion.pv_activo && cExplosion.pv_ajuste_pct !== 0 ? cExplosion.pv_ajuste_pct : 0
                          setPvMargen(cExplosion.pv_activo ? String(cExplosion.pv_margen_pct) : '')
                          setPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
                          setPvAjusteSign(aj < 0 ? '-' : '+')
                          setPvSaveMsg('')
                        }}>Deshacer</button>
                        {cExplosion.pv_activo && (
                          <button className="btn btn-danger btn-sm" onClick={resetPrecioVenta} disabled={pvSaving}>
                            Predeterminado
                          </button>
                        )}
                        {pvSaveMsg && <span style={{ fontSize: '0.82rem', color: pvSaveMsg === 'Error al guardar' ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{pvSaveMsg}</span>}
                      </div>
                    </div>
                  )
                })()}

                {cExplosion?.detail && (
                  <div className="alert alert-error" style={{ maxWidth: 860 }}>⚠️ {cExplosion.detail}</div>
                )}
              </>
            )}

            {/* ── MODO CONSULTA MASIVA ── */}
            {consultaMode === 'masivo' && (
              <>
                {/* Filtros */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="field" style={{ flex: '1 1 260px', margin: 0 }}>
                      <label>Familia</label>
                      <select value={masivFamilia} onChange={e => onFamiliaChange(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                        <option value="">— Todas las familias —</option>
                        {masivFamilias.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ flex: '1 1 260px', margin: 0 }}>
                      <label>Subfamilia</label>
                      <select value={masivSubfamilia} onChange={e => { setMasivSubfamilia(e.target.value); setMasivExplosion(null) }}
                        style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                        <option value="">— Todas las subfamilias —</option>
                        {masivSubfamilias.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                      <label>Buscar en resultados</label>
                      <input
                        type="text"
                        placeholder="SKU, nombre, familia…"
                        value={masivSearch}
                        onChange={e => setMasivSearch(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem', boxSizing: 'border-box' }}
                      />
                    </div>
                    <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}
                      onClick={loadMasivo} disabled={masivLoading}>
                      {masivLoading ? 'Calculando…' : '🔎 Consultar'}
                    </button>
                    <button className="btn btn-ghost btn-sm"
                      disabled={masivResultados.length === 0 && !masivFamilia && !masivSubfamilia}
                      onClick={() => { setMasivResultados([]); setMasivExplosion(null); setMasivFamilia(''); setMasivSubfamilia('') }}>
                      ✕ Limpiar
                    </button>
                  </div>
                </div>

                {/* Panel Precio de Venta Masivo */}
                {masivResultados.length > 0 && (
                  <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--primary)', borderWidth: 1.5 }}>
                    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div className="fw-700 text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary-dark)', whiteSpace: 'nowrap' }}>
                        💰 Precio de Venta Masivo
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Margen %</label>
                        <input
                          type="text" inputMode="decimal" className="no-spin"
                          value={masivPvMargen}
                          placeholder="Ej: 20"
                          onChange={e => { setMasivPvMargen(e.target.value); setMasivPvSaveMsg('') }}
                          style={{ width: 72, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85rem', textAlign: 'right' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Ajuste %</label>
                        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                          <button onClick={() => setMasivPvAjusteSign('+')}
                            style={{ padding: '0.3rem 0.55rem', background: masivPvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: masivPvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                            ▲ Subir
                          </button>
                          <button onClick={() => setMasivPvAjusteSign('-')}
                            style={{ padding: '0.3rem 0.55rem', background: masivPvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: masivPvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>
                            ▼ Bajar
                          </button>
                        </div>
                        <input
                          type="text" inputMode="decimal" className="no-spin"
                          value={masivPvAjuste}
                          placeholder="0"
                          onChange={e => { setMasivPvAjuste(e.target.value.replace('-', '')); setMasivPvSaveMsg('') }}
                          style={{ width: 56, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85rem', textAlign: 'right' }}
                        />
                      </div>
                      {masivPvMargen.trim() && (() => {
                        const m = parseFloat(masivPvMargen.replace(',', '.')) || 0
                        const a = parseFloat(masivPvAjuste.replace(',', '.')) || 0
                        const aConSigno = masivPvAjusteSign === '-' ? -a : a
                        const factor = (1 + m / 100) * (1 + aConSigno / 100)
                        return (
                          <span style={{ fontSize: '0.75rem', color: 'var(--primary-dark)', fontWeight: 600, background: 'var(--primary-light)', borderRadius: 6, padding: '0.2rem 0.5rem' }}>
                            ×{factor.toFixed(3)} sobre costo producción
                          </span>
                        )
                      })()}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        {masivResultados.filter((pt: any) => pt.costo_final_clp > 0).length} productos con costo
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button className="btn btn-primary btn-sm"
                          disabled={!masivPvMargen.trim() || masivPvSaving}
                          onClick={saveMasivoPV}>
                          {masivPvSaving ? 'Guardando…' : 'Grabar'}
                        </button>
                        {masivResultados.some((pt: any) => pt.pv_activo) && (
                          <button className="btn btn-ghost btn-sm"
                            disabled={masivPvSaving}
                            onClick={resetMasivoPV}>
                            Predeterminado
                          </button>
                        )}
                        {masivPvSaveMsg && (
                          <span style={{ fontSize: '0.78rem', color: masivPvSaveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                            {masivPvSaveMsg === 'Guardado' ? '✓ Guardado' : masivPvSaveMsg === 'Restablecido' ? '✓ Restablecido' : masivPvSaveMsg}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabla de resultados masivos */}
                {masivResultados.length > 0 && (
                  <div className="card">
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span className="card-title" style={{ margin: 0 }}>
                        {masivSearch.trim()
                          ? `${masivResultados.filter((pt: any) => { const q = masivSearch.trim().toLowerCase(); return pt.sku?.toLowerCase().includes(q) || pt.nombre?.toLowerCase().includes(q) || pt.familia?.toLowerCase().includes(q) || pt.subfamilia?.toLowerCase().includes(q) }).length} de ${masivResultados.length} productos`
                          : `${masivResultados.length} productos`
                        }{masivFamilia ? ` · ${masivFamilia}` : ''}{masivSubfamilia ? ` › ${masivSubfamilia}` : ''}
                      </span>
                      {!masivExplosion && <span className="text-muted text-xs">Haz clic en un producto para ver su formulación</span>}
                      <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => {
                        const filtrados = masivSearch.trim()
                          ? masivResultados.filter((pt: any) => { const q = masivSearch.trim().toLowerCase(); return pt.sku?.toLowerCase().includes(q) || pt.nombre?.toLowerCase().includes(q) || pt.familia?.toLowerCase().includes(q) || pt.subfamilia?.toLowerCase().includes(q) })
                          : masivResultados
                        exportToExcel([{ name: 'Costos Masivo', data: filtrados.map((pt: any) => ({
                          'SKU': pt.sku, 'Nombre': pt.nombre, 'Familia': pt.familia || '', 'Subfamilia': pt.subfamilia || '',
                          'Costo MP CLP': parseFloat(pt.costo_mp_clp) || 0,
                          'Costo Insumos CLP': parseFloat(pt.costo_insumos_clp) || 0,
                          'Gastos Adicionales CLP': parseFloat(pt.gastos_adicionales_clp) || 0,
                          'Costo Final CLP': parseFloat(pt.costo_final_clp) || 0,
                          'Precio Terreno CLP': parseFloat(pt.precio_terreno_clp) || 0,
                          'Insumos sin precio': pt.insumos_sin_precio, 'Tiene BOM': pt.tiene_bom ? 'Sí' : 'No',
                        })) }], `CostosMasivo_${masivFamilia || 'Todos'}_${new Date().toISOString().slice(0,10)}.xlsx`)
                      }}>📥 Exportar Excel</button>
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                      {/* Lista de productos */}
                      <div className="tbl-wrap" style={{ flex: masivExplosion ? '0 0 460px' : '1' }}>
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Nombre</th>
                              {!masivExplosion && <th>Subfamilia</th>}
                              <th className="num">Costo MP</th>
                              <th className="num">Insumos</th>
                              <th className="num">Gastos Adic.</th>
                              <th className="num">Costo Prod.</th>
                              <th className="num" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                                Precio Terreno
                                <div style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-3)', marginTop: 1 }}>c/ flete + pallet</div>
                              </th>
                              <th className="ctr">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const masivFiltrado = masivResultados.filter((pt: any) => {
                                if (!masivSearch.trim()) return true
                                const q = masivSearch.trim().toLowerCase()
                                return pt.sku?.toLowerCase().includes(q) || pt.nombre?.toLowerCase().includes(q) || pt.familia?.toLowerCase().includes(q) || pt.subfamilia?.toLowerCase().includes(q)
                              })
                              const masivTotalPages = Math.ceil(masivFiltrado.length / MASIV_PAGE_SIZE)
                              const masivPageSafe = Math.min(masivPage, masivTotalPages || 1)
                              const masivPaged = masivFiltrado.slice((masivPageSafe - 1) * MASIV_PAGE_SIZE, masivPageSafe * MASIV_PAGE_SIZE)
                              return (<>
                                {masivPaged.map((pt: any, i: number) => {
                              const isSelected = masivExplosion?.sku === pt.sku
                              const sinCosto = !pt.precio_terreno_clp
                              return (
                                <tr key={i}
                                  onClick={() => loadMasivExplosion(pt.sku, pt.nombre)}
                                  style={{
                                    cursor: 'pointer',
                                    background: isSelected ? 'var(--primary-light)' : sinCosto ? '#fffbeb' : '',
                                    borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                                  }}>
                                  <td><span className="fw-600 text-xs" style={{ color: 'var(--primary)' }}>{pt.sku}</span></td>
                                  <td style={{ maxWidth: masivExplosion ? 160 : 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={pt.nombre}>{pt.nombre}</td>
                                  {!masivExplosion && <td><span className="text-muted text-xs">{pt.subfamilia}</span></td>}
                                  <td className="num text-xs" style={{ color: !pt.costo_mp_clp ? 'var(--warning)' : 'inherit' }}>
                                    {!pt.costo_mp_clp ? '—' : `$${fmt(pt.costo_mp_clp)}`}
                                  </td>
                                  <td className="num text-xs" style={{ color: 'var(--warning)' }}>
                                    {!pt.costo_insumos_clp ? '—' : `$${fmt(pt.costo_insumos_clp)}`}
                                  </td>
                                  <td className="num text-xs text-muted">
                                    {!pt.gastos_adicionales_clp ? '—' : `$${fmt(pt.gastos_adicionales_clp)}`}
                                  </td>
                                  <td className="num" style={{ color: 'var(--text-2)', fontSize: '0.8rem' }}>
                                    {!pt.costo_final_clp ? '—' : `$${fmt(pt.costo_final_clp)}`}
                                  </td>
                                  <td className="num fw-700" style={{ color: pt.pv_activo ? 'var(--primary-dark)' : 'var(--primary)' }}>
                                    {!pt.precio_terreno_clp ? '—' : `$${fmt(pt.precio_terreno_clp)}`}
                                    {pt.pv_activo && <div><span className="badge badge-green" style={{ fontSize: '0.65rem' }}>PV</span></div>}
                                  </td>
                                  <td className="ctr">
                                    {!pt.tiene_bom && <span className="badge badge-gray">Sin BOM</span>}
                                    {pt.tiene_bom && pt.insumos_sin_precio > 0 && <span className="badge badge-yellow">⚠ {pt.insumos_sin_precio}</span>}
                                    {pt.tiene_bom && pt.insumos_sin_precio === 0 && <span className="badge badge-green">✓</span>}
                                  </td>
                                </tr>
                              )
                            })}
                            {masivFiltrado.length > MASIV_PAGE_SIZE && (
                              <tr>
                                <td colSpan={masivExplosion ? 7 : 8} style={{ padding: '0.5rem 0.65rem', background: 'var(--bg)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', flex: 1 }}>
                                      {((masivPageSafe - 1) * MASIV_PAGE_SIZE) + 1}–{Math.min(masivPageSafe * MASIV_PAGE_SIZE, masivFiltrado.length)} de {masivFiltrado.length}
                                    </span>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setMasivPage(1)} disabled={masivPageSafe === 1}>«</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setMasivPage(p => Math.max(1, p - 1))} disabled={masivPageSafe === 1}>‹</button>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)' }}>{masivPageSafe}/{masivTotalPages}</span>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setMasivPage(p => Math.min(masivTotalPages, p + 1))} disabled={masivPageSafe === masivTotalPages}>›</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setMasivPage(masivTotalPages)} disabled={masivPageSafe === masivTotalPages}>»</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>)
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* Panel de formulación (drill-down al hacer clic) */}
                      {masivExplosion && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <div>
                              <div className="fw-700" style={{ fontSize: '0.9rem', color: 'var(--secondary)' }}>📦 {masivExplosion.sku}</div>
                              <div className="text-muted text-xs">{masivExplosion.nombre}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
                              {masivExplosion.data.densidad > 0 && <div className="stat-box" style={{ margin: 0 }}><span className="stat-label">Densidad</span><span className="stat-value">{fmt(masivExplosion.data.densidad, 3)} kg/L</span></div>}
                              {masivExplosion.data.peso_kilos > 0 && <div className="stat-box" style={{ margin: 0 }}><span className="stat-label">Kilos</span><span className="stat-value">{fmt(masivExplosion.data.peso_kilos, 3)} kg</span></div>}
                              {masivExplosion.data.litros_formato > 0 && <div className="stat-box" style={{ margin: 0 }}><span className="stat-label">Litros</span><span className="stat-value">{fmt(masivExplosion.data.litros_formato, 3)} L</span></div>}
                              <div className="stat-box" style={{ margin: 0 }}><span className="stat-label">Costo MP</span><span className="stat-value">${fmt(masivExplosion.data.costo_mp_clp)}</span></div>
                              <div className="stat-box warning" style={{ margin: 0 }}><span className="stat-label">Insumos</span><span className="stat-value">${fmt(masivExplosion.data.costo_insumos_clp)}</span></div>
                              <div className="stat-box" style={{ margin: 0 }}><span className="stat-label">Gastos Adic.</span><span className="stat-value">${fmt((masivExplosion.data.flete_clp || 0) + (masivExplosion.data.pallet_clp || 0) + (masivExplosion.data.ley_rep_clp || 0) + (masivExplosion.data.disposicion_clp || 0) + (masivExplosion.data.gtos_indirectos_clp || 0))}</span></div>
                              <div className="stat-box primary" style={{ margin: 0 }}><span className="stat-label">Costo Final</span><span className="stat-value">${fmt(masivExplosion.data.costo_final_clp)}</span></div>
                              <button className="btn btn-primary btn-sm" style={{ alignSelf: 'center' }} onClick={() => exportBomToExcel(masivExplosion.sku, masivExplosion.nombre, masivExplosion.data)}>📥 Excel</button>
                              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setMasivExplosion(null)}>✕</button>
                            </div>
                          </div>
                          <div className="tbl-wrap">
                            <table className="tbl">
                              <thead>
                                <tr>
                                  <th>Código</th><th>Materia Prima</th>
                                  <th className="num">Cantidad</th>
                                  <th className="num">Unit. CLP</th><th className="num">Unit. USD</th>
                                  <th className="ctr">Fuente</th>
                                  <th className="num">Sub. CLP</th><th className="num">Sub. USD</th>
                                </tr>
                              </thead>
                              <tbody>
                                <TablaInsumos insumos={masivExplosion.data.detalle_insumos || []} />
                              </tbody>
                            </table>
                          </div>

                          {/* Desglose Gastos Adicionales — igual a Por SKU */}
                          {(() => {
                            const d = masivExplosion.data
                            const bom = (d.costo_mp_clp || 0) + (d.costo_insumos_clp || 0)
                            const mermaFactor = d.merma_factor || 1
                            const mermaAmt = bom * (mermaFactor - 1)
                            const tc = d.tipo_cambio_usd || 950
                            const flete = d.flete_clp || 0
                            const pallet = d.pallet_clp || 0
                            const leyRep = d.ley_rep_clp || 0
                            const disp = d.disposicion_clp || 0
                            const gtos = d.gtos_indirectos_clp || 0
                            const total = mermaAmt + flete + pallet + leyRep + disp + gtos
                            const rows: Array<{ label: React.ReactNode; clp: number; color: string }> = [
                              ...(mermaAmt > 0 ? [{ label: <span>Merma global (×{mermaFactor})</span>, clp: mermaAmt, color: '#d97706' }] : []),
                              { label: <span>Flete (Terreno)</span>, clp: flete, color: 'var(--text-2)' },
                              { label: <span>Pallet (Terreno)</span>, clp: pallet, color: 'var(--text-2)' },
                              { label: <span>Ley REP</span>, clp: leyRep, color: 'var(--text-2)' },
                              { label: <span>Disposición</span>, clp: disp, color: 'var(--text-2)' },
                              { label: <span>Gastos Indirectos</span>, clp: gtos, color: 'var(--text-2)' },
                            ]
                            return (
                              <div style={{ marginTop: '1rem' }}>
                                <div className="fw-600 text-xs" style={{ marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Gastos Adicionales</div>
                                <div className="tbl-wrap">
                                  <table className="tbl">
                                    <thead>
                                      <tr>
                                        <th>Concepto</th>
                                        <th className="num">CLP</th>
                                        <th className="num">USD</th>
                                        <th className="num">% s/ Costo Final</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((r, i) => (
                                        <tr key={i}>
                                          <td style={{ color: r.color }}>{r.label}</td>
                                          <td className="num">${fmt(r.clp, 2)}</td>
                                          <td className="num" style={{ color: '#6b7280' }}>{(r.clp / tc).toFixed(2)}</td>
                                          <td className="num" style={{ color: '#6b7280' }}>{d.costo_final_clp > 0 ? ((r.clp / d.costo_final_clp) * 100).toFixed(1) + '%' : '—'}</td>
                                        </tr>
                                      ))}
                                      <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)', background: '#f8faf4' }}>
                                        <td>Total gastos</td>
                                        <td className="num">${fmt(total, 2)}</td>
                                        <td className="num" style={{ color: '#6b7280' }}>{(total / tc).toFixed(2)}</td>
                                        <td className="num" style={{ color: '#6b7280' }}>{d.costo_final_clp > 0 ? ((total / d.costo_final_clp) * 100).toFixed(1) + '%' : '—'}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )
                          })()}

                          {/* Panel PV por producto — igual a Por SKU */}
                          {masivExplosion.data.costo_final_clp > 0 && (() => {
                            const costoBase = masivExplosion.data.costo_final_clp
                            const margenNum = parseFloat(masivSkuPvMargen.replace(',', '.')) || 0
                            const absAj = parseFloat(masivSkuPvAjuste.replace(',', '.')) || 0
                            const ajusteNum = masivSkuPvAjusteSign === '-' ? -absAj : absAj
                            const pvCalc = costoBase * (1 + margenNum / 100)
                            const pfCalc = pvCalc * (1 + ajusteNum / 100)
                            const hayAjuste = ajusteNum !== 0
                            const pvData = masivExplosion.data
                            return (
                              <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: 8, border: pvData.pv_activo ? '2px solid var(--primary)' : '1px solid var(--border)', background: pvData.pv_activo ? 'var(--primary-light)' : '#fafafa' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                  <span className="fw-700 text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary-dark)' }}>💰 Precio de Venta</span>
                                  {pvData.pv_activo && <span className="badge badge-green">Override activo</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
                                  <div className="stat-box" style={{ margin: 0 }}>
                                    <span className="stat-label">Costo Final</span>
                                    <span className="stat-value">${fmt(costoBase)}</span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Margen %</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <input type="text" inputMode="decimal" className="no-spin"
                                        value={masivSkuPvMargen} placeholder="0"
                                        onChange={e => { setMasivSkuPvMargen(e.target.value); setMasivSkuPvSaveMsg('') }}
                                        style={{ width: 64, border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.4rem', fontSize: '0.85rem', textAlign: 'right' }} />
                                      <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>%</span>
                                    </div>
                                  </div>
                                  <div className={`stat-box${margenNum !== 0 ? ' primary' : ''}`} style={{ margin: 0 }}>
                                    <span className="stat-label">Precio de Venta</span>
                                    <span className="stat-value">${fmt(pvCalc)}</span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Ajuste %</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                        <button onClick={() => setMasivSkuPvAjusteSign('+')}
                                          style={{ padding: '0.2rem 0.4rem', background: masivSkuPvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: masivSkuPvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>▲</button>
                                        <button onClick={() => setMasivSkuPvAjusteSign('-')}
                                          style={{ padding: '0.2rem 0.4rem', background: masivSkuPvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: masivSkuPvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>▼</button>
                                      </div>
                                      <input type="text" inputMode="decimal" className="no-spin"
                                        value={masivSkuPvAjuste} placeholder="0"
                                        onChange={e => { setMasivSkuPvAjuste(e.target.value.replace('-', '')); setMasivSkuPvSaveMsg('') }}
                                        style={{ width: 52, border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.4rem', fontSize: '0.85rem', textAlign: 'right' }} />
                                      <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>%</span>
                                    </div>
                                  </div>
                                  {hayAjuste && (
                                    <div className="stat-box warning" style={{ margin: 0 }}>
                                      <span className="stat-label">Precio Ajustado</span>
                                      <span className="stat-value">${fmt(pfCalc)}</span>
                                    </div>
                                  )}
                                </div>
                                {pvData.pv_activo && (
                                  <div style={{ background: '#d4edda', borderRadius: 6, padding: '0.35rem 0.6rem', marginBottom: '0.5rem', fontSize: '0.78rem', color: '#1a6b30' }}>
                                    Guardado: P. Venta = <strong>${fmt(pvData.pv_precio_venta)}</strong>
                                    {pvData.pv_ajuste_pct !== 0 && <> → Ajustado = <strong>${fmt(pvData.pv_precio_final)}</strong></>}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <button className="btn btn-primary btn-sm" onClick={saveMasivSkuPV} disabled={masivSkuPvSaving || !masivSkuPvMargen}>
                                    {masivSkuPvSaving ? 'Guardando…' : 'Grabar'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => {
                                    setMasivSkuPvMargen(pvData.pv_activo ? String(pvData.pv_margen_pct) : '')
                                    const aj = pvData.pv_activo && pvData.pv_ajuste_pct !== 0 ? pvData.pv_ajuste_pct : 0
                                    setMasivSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
                                    setMasivSkuPvAjusteSign(aj < 0 ? '-' : '+')
                                    setMasivSkuPvSaveMsg('')
                                  }}>Deshacer</button>
                                  {pvData.pv_activo && (
                                    <button className="btn btn-danger btn-sm" onClick={resetMasivSkuPV} disabled={masivSkuPvSaving}>Predeterminado</button>
                                  )}
                                  {masivSkuPvSaveMsg && (
                                    <span style={{ fontSize: '0.78rem', color: masivSkuPvSaveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                                      {masivSkuPvSaveMsg === 'Guardado' ? '✓ Guardado' : masivSkuPvSaveMsg === 'Restablecido' ? '✓ Restablecido' : masivSkuPvSaveMsg}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {masivResultados.length === 0 && !masivLoading && masivFamilia && (
                  <div className="empty-state">No se encontraron productos para los filtros seleccionados.</div>
                )}
                {masivResultados.length === 0 && !masivLoading && !masivFamilia && (
                  <div className="empty-state">Selecciona una familia y presiona Consultar para ver los costos.</div>
                )}
              </>
            )}

            {/* ══ COSTOS POR CADENA ══ */}
            {consultaMode === 'cadenas' && (
              <>
                {/* Sub-tabs */}
                <div className="mode-tabs" style={{ marginBottom: '1.25rem' }}>
                  <button className={`mode-tab${cadenaMode === 'sku' ? ' active' : ''}`}
                    onClick={() => setCadenaMode('sku')}>🔍 Por SKU</button>
                  <button className={`mode-tab${cadenaMode === 'masivo' ? ' active' : ''}`}
                    onClick={() => setCadenaMode('masivo')}>📊 Consulta Masiva</button>
                </div>

                {/* ─ SUB-MODO POR SKU ─ */}
                {cadenaMode === 'sku' && (
                  <>
                    <div className="searchbar" style={{ marginBottom: '1rem', maxWidth: 520 }}>
                      <span className="sb-label">Producto</span>
                      <div className="sb-divider" />
                      <div className="sb-input-wrap">
                        <input type="text" placeholder="Buscar por código o nombre…"
                          value={cadSkuSearch} onChange={e => { searchCadSku(e.target.value); acCad.reset() }}
                          onKeyDown={e => acCad.onKeyDown(e, cadSkuSug.length, () => { const s = cadSkuSug[acCad.idx]; if (s) selectCadSku(s.sku, s.nombre) })}
                          autoComplete="off" />
                        {cadSkuSug.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {cadSkuSug.map((s: any, i: number) => (
                              <div key={s.sku} className={`autocomplete-item${i === acCad.idx ? ' active' : ''}`} onClick={() => selectCadSku(s.sku, s.nombre)}>
                                <span className="ac-sku">{s.sku}</span>
                                <span className="ac-name">{s.nombre}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {cadSku && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                        onClick={() => { setCadSku(''); setCadSkuNombre(''); setCadSkuSearch(''); setCadExplosion(null); setCadExpandida(null) }}>✕</button>}
                    </div>

                    {cadSkuLoading && <SkeletonCards n={4} />}

                    {cadSku && !cadSkuLoading && cadExplosion && !cadExplosion.detail && (() => {
                      const rent: any[] = cadExplosion.rentabilidad_clientes || []
                      const detalle: any[] = cadExplosion.detalle_insumos || []
                      const cBase = cadExplosion.costo_final_clp || 0
                      const rentExpandida = rent.find((r: any) => r.cliente === cadExpandida)

                      return (
                        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          {/* Tabla de cadenas */}
                          <div className="card" style={{ flex: cadExpandida ? '0 0 520px' : '1', minWidth: 380 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>📦 {cadSku}</span>
                              <span style={{ color: 'var(--text-2)', fontSize: '0.82rem' }}>{cadSkuNombre}</span>
                              <span className="badge badge-gray">Base: {fmtCLP(cBase)}</span>
                              {cadExplosion.peso_kilos > 0 && <span className="badge badge-blue">{fmt(cadExplosion.peso_kilos, 3)} kg</span>}
                              <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => exportBomToExcel(cadSku, cadSkuNombre, cadExplosion)}>📥 Excel</button>
                            </div>
                            {cadExpandida && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: '0.5rem' }}>← Haz clic en otra cadena para cambiar</div>}
                            {rent.length === 0
                              ? <div className="empty-state">Sin cadenas configuradas.</div>
                              : (
                                <div className="tbl-wrap">
                                  <table className="tbl">
                                    <thead>
                                      <tr>
                                        <th>Cadena</th>
                                        <th className="num">P. Lista</th>
                                        <th className="num">P. Final</th>
                                        <th className="num">Mg Final</th>
                                        <th className="ctr">Ver</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rent.map((r: any) => {
                                        const mgColor = r.mg_final_porc >= 10 ? 'var(--success)' : r.mg_final_porc >= 0 ? 'var(--warning)' : 'var(--danger)'
                                        const isActive = cadExpandida === r.cliente
                                        return (
                                          <tr key={r.cliente}
                                            style={{ cursor: 'pointer', background: isActive ? 'var(--primary-light)' : undefined }}
                                            onClick={() => setCadExpandida(isActive ? null : r.cliente)}>
                                            <td style={{ fontWeight: isActive ? 700 : 600 }}>{r.cliente}</td>
                                            <td className="num">{fmtCLP(r.precio_lista_envase)}</td>
                                            <td className="num fw-600">{fmtCLP(r.precio_final_envase)}</td>
                                            <td className="num" style={{ color: mgColor, fontWeight: 700 }}>{r.mg_final_porc.toFixed(1)}%</td>
                                            <td className="ctr" style={{ color: isActive ? 'var(--primary-dark)' : '#aaa' }}>{isActive ? '▶' : '›'}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            }
                          </div>

                          {/* Panel de detalle de la cadena seleccionada */}
                          {cadExpandida && rentExpandida && (
                            <div className="card" style={{ flex: 1, minWidth: 480 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--secondary)' }}>
                                🏪 {cadExpandida}
                              </div>

                              {/* KPIs cadena */}
                              <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
                                {[
                                  { label: 'Costo Parcial', val: fmtCLP(rentExpandida.costo_parcial), cls: '' },
                                  { label: 'Precio Lista', val: fmtCLP(rentExpandida.precio_lista_envase), cls: '' },
                                  { label: 'Precio Final', val: fmtCLP(rentExpandida.precio_final_envase), cls: 'primary' },
                                  { label: 'Utilidad', val: fmtCLP(rentExpandida.utilidad_final), cls: rentExpandida.utilidad_final >= 0 ? 'success' : 'danger' },
                                  { label: 'Mg Final', val: rentExpandida.mg_final_porc.toFixed(1) + '%', cls: rentExpandida.mg_final_porc >= 10 ? 'success' : rentExpandida.mg_final_porc >= 0 ? 'warning' : 'danger' },
                                ].map(k => (
                                  <div key={k.label} className={`stat-box${k.cls ? ' ' + k.cls : ''}`} style={{ flex: '1 1 100px', minWidth: 100 }}>
                                    <span className="stat-label">{k.label}</span>
                                    <span className="stat-value">{k.val}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Desglose de costos de la cadena */}
                              {(() => {
                                const ex = cadExplosion
                                const r  = rentExpandida
                                const bomBruto    = (ex.costo_mp_clp || 0) + (ex.costo_insumos_clp || 0)
                                const bomMerma    = ex.costo_total_con_merma || 0
                                const mermaDelta  = bomMerma - bomBruto
                                const mermaFactor = ex.merma_factor || 1
                                const leyRep      = ex.ley_rep_clp || 0
                                const disp        = ex.disposicion_clp || 0
                                const gtos        = ex.gtos_indirectos_clp || 0
                                const flete       = r.flete_clp || 0
                                const pallet      = r.pallet_clp || 0
                                const cParcial    = r.costo_parcial || 0
                                const plb         = r.precio_lista_envase || 0
                                const pFinal      = r.precio_final_envase || 0
                                const comision    = r.comision_monto || 0
                                const planCom     = r.plan_comercial_monto || 0
                                const utilidad    = r.utilidad_final || 0
                                const factor      = cParcial > 0 ? plb / cParcial : 1
                                const descuento   = plb - pFinal

                                type RowType = { label?: string; val?: string; indent?: boolean; bold?: boolean; subtotal?: boolean; color?: string; section?: string; sign?: string }
                                const rows: RowType[] = [
                                  { section: '— ESTRUCTURA DE COSTO —' },
                                  { label: 'Materias Primas',         val: fmtCLP(ex.costo_mp_clp || 0),   indent: true  },
                                  { label: 'Packaging / Insumos',     val: fmtCLP(ex.costo_insumos_clp || 0), indent: true },
                                  { label: '= BOM Bruto',             val: fmtCLP(bomBruto),                subtotal: true },
                                  ...(mermaFactor > 1 ? [
                                    { label: `(+) Merma ×${mermaFactor.toFixed(3)}`, val: `+${fmtCLP(mermaDelta)}`, indent: true, color: '#d97706', sign: '+' },
                                    { label: '= BOM c/ Merma',        val: fmtCLP(bomMerma),                subtotal: true },
                                  ] : []),
                                  { label: '(+) Ley REP',             val: `+${fmtCLP(leyRep)}`,  indent: true, color: 'var(--text-2)' },
                                  { label: '(+) Disposición',         val: `+${fmtCLP(disp)}`,    indent: true, color: 'var(--text-2)' },
                                  { label: '(+) Gastos Indirectos',   val: `+${fmtCLP(gtos)}`,    indent: true, color: 'var(--text-2)' },
                                  { label: '(+) Flete',               val: `+${fmtCLP(flete)}`,   indent: true, color: 'var(--text-2)' },
                                  ...(pallet > 0 ? [{ label: '(+) Pallet', val: `+${fmtCLP(pallet)}`, indent: true, color: 'var(--text-2)' }] : []),
                                  { label: '= Costo Parcial',         val: fmtCLP(cParcial),                bold: true,  subtotal: true },
                                  { section: '— CASCADA DE PRECIO —' },
                                  { label: `× Factor (×${factor.toFixed(3)})`, val: fmtCLP(plb), indent: true, color: 'var(--info)' },
                                  { label: '= Precio Lista (PLB)',    val: fmtCLP(plb),                     bold: true,  subtotal: true },
                                  ...(descuento > 0 ? [{ label: '(-) Descuento comercial', val: `-${fmtCLP(descuento)}`, indent: true, color: '#dc2626' }] : []),
                                  { label: '= Precio Final',          val: fmtCLP(pFinal),                  bold: true,  subtotal: true, color: '#16a34a' },
                                  { section: '— RESULTADO —' },
                                  ...(comision > 0 ? [{ label: '(-) Comisión',       val: `-${fmtCLP(comision)}`,  indent: true, color: '#dc2626' }] : []),
                                  ...(planCom > 0  ? [{ label: '(-) Plan Comercial', val: `-${fmtCLP(planCom)}`,   indent: true, color: '#dc2626' }] : []),
                                  { label: '= Utilidad Neta',         val: fmtCLP(utilidad),                bold: true,  subtotal: true, color: utilidad >= 0 ? '#16a34a' : '#dc2626' },
                                ]

                                return (
                                  <div style={{ background: '#f8faf4', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.81rem' }}>
                                    <div style={{ fontWeight: 600, marginBottom: '0.6rem', color: 'var(--text-2)' }}>Desglose de costos</div>
                                    {rows.map((row, i) => {
                                      if (row.section) return (
                                        <div key={i} style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', padding: '6px 0 2px', marginTop: i > 0 ? 4 : 0 }}>
                                          {row.section}
                                        </div>
                                      )
                                      return (
                                        <div key={i} style={{
                                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                          padding: row.subtotal ? '4px 0' : '2px 0',
                                          borderBottom: row.subtotal ? '1px solid var(--border)' : undefined,
                                          fontWeight: row.bold ? 700 : 400,
                                        }}>
                                          <span style={{ color: 'var(--text-2)', paddingLeft: row.indent ? '0.8rem' : 0 }}>{row.label}</span>
                                          <span style={{ color: row.color || (row.bold ? 'var(--secondary)' : '#444'), fontVariantNumeric: 'tabular-nums' }}>{row.val}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })()}

                              {/* Receta completa separada MP / Packaging */}
                              {(() => {
                                const mp  = detalle.filter((ins: any) => !FAMILIAS_PACKAGING_SET.has((ins.familia || '').toUpperCase()))
                                const pkg = detalle.filter((ins: any) =>  FAMILIAS_PACKAGING_SET.has((ins.familia || '').toUpperCase()))
                                const totalMP  = mp.reduce((s: number, ins: any) => s + ins.costo_teorico_total_clp, 0)
                                const totalPkg = pkg.reduce((s: number, ins: any) => s + ins.costo_teorico_total_clp, 0)
                                const totalBOM = totalMP + totalPkg

                                const renderRows = (rows: any[]) => rows.map((ins: any, i: number) => (
                                  <tr key={`${ins.insumo_final}-${i}`}>
                                    <td style={{ fontFamily: 'monospace' }}>{ins.insumo_final}</td>
                                    <td>{ins.nombre_insumo}</td>
                                    <td className="num">{fmt(ins.cantidad_requerida_formato, 4)}</td>
                                    <td className="num">{fmtCLP(ins.costo_unitario_clp_actual, 2)}</td>
                                    <td className="num fw-600">{fmtCLP(ins.costo_teorico_total_clp, 2)}</td>
                                    <td className="ctr">
                                      <span className={`badge ${ins.fuente_costo === 'compra' ? 'badge-green' : ins.fuente_costo === 'manual' ? 'badge-blue' : 'badge-red'}`}>
                                        {ins.fuente_costo || 'sin precio'}
                                      </span>
                                    </td>
                                  </tr>
                                ))

                                return (
                                  <div className="tbl-wrap">
                                    <table className="tbl" style={{ fontSize: '0.78rem' }}>
                                      <thead>
                                        <tr>
                                          <th>Código</th>
                                          <th>Insumo</th>
                                          <th className="num">Cantidad</th>
                                          <th className="num">Costo Unit.</th>
                                          <th className="num">Subtotal</th>
                                          <th className="ctr">Fuente</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {/* ── Materias Primas ── */}
                                        {mp.length > 0 && (
                                          <tr style={{ background: '#f0f7e0' }}>
                                            <td colSpan={6} style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--primary-dark)', padding: '4px 8px', letterSpacing: '0.04em' }}>
                                              MATERIAS PRIMAS
                                            </td>
                                          </tr>
                                        )}
                                        {renderRows(mp)}
                                        {mp.length > 0 && (
                                          <tr style={{ background: '#e8f4d0', fontWeight: 700 }}>
                                            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '0.5rem', color: 'var(--primary-dark)' }}>Subtotal MP</td>
                                            <td className="num" style={{ color: 'var(--primary-dark)' }}>{fmtCLP(totalMP, 2)}</td>
                                            <td />
                                          </tr>
                                        )}

                                        {/* ── Packaging ── */}
                                        {pkg.length > 0 && (
                                          <tr style={{ background: '#eff6ff' }}>
                                            <td colSpan={6} style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--info)', padding: '4px 8px', letterSpacing: '0.04em' }}>
                                              PACKAGING / ENVASE
                                            </td>
                                          </tr>
                                        )}
                                        {renderRows(pkg)}
                                        {pkg.length > 0 && (
                                          <tr style={{ background: '#dbeafe', fontWeight: 700 }}>
                                            <td colSpan={4} style={{ textAlign: 'right', paddingRight: '0.5rem', color: 'var(--info)' }}>Subtotal Packaging</td>
                                            <td className="num" style={{ color: 'var(--info)' }}>{fmtCLP(totalPkg, 2)}</td>
                                            <td />
                                          </tr>
                                        )}

                                        {/* ── Total BOM ── */}
                                        <tr style={{ background: 'var(--primary-light)', fontWeight: 800, borderTop: '2px solid var(--primary)' }}>
                                          <td colSpan={4} style={{ textAlign: 'right', paddingRight: '0.5rem' }}>
                                            Total BOM {totalMP > 0 && totalPkg > 0 && <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--text-2)' }}>(MP + Packaging)</span>}
                                          </td>
                                          <td className="num">{fmtCLP(totalBOM, 2)}</td>
                                          <td />
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Panel Precio de Venta — Por SKU cadenas */}
                    {cadSku && !cadSkuLoading && cadExplosion && !cadExplosion.detail && cadExplosion.costo_final_clp > 0 && (() => {
                      const rentAll  = cadExplosion.rentabilidad_clientes || []
                      const rentEx   = rentAll.find((r: any) => r.cliente === cadExpandida)
                      const costoBase = rentEx?.costo_parcial || cadExplosion.costo_final_clp
                      const labelBase = rentEx ? `Costo Parcial — ${cadExpandida}` : 'Costo Final (base)'
                      const margenNum = parseFloat(cadSkuPvMargen.replace(',', '.')) || 0
                      const absAj     = parseFloat(cadSkuPvAjuste.replace(',', '.')) || 0
                      const ajusteNum = cadSkuPvAjusteSign === '-' ? -absAj : absAj
                      const pvCalc    = costoBase * (1 + margenNum / 100)
                      const pfCalc    = pvCalc * (1 + ajusteNum / 100)
                      const hayAjuste = ajusteNum !== 0
                      return (
                        <div className="card" style={{ marginTop: '1rem', border: cadExplosion.pv_activo ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                            <span className="card-title" style={{ margin: 0 }}>💰 Precio de Venta</span>
                            {cadExplosion.pv_activo && <span className="badge badge-green">Override activo</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                            <div className="stat-box" style={{ margin: 0 }}>
                              <span className="stat-label">{labelBase}</span>
                              <span className="stat-value">${fmt(costoBase)}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Margen %</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="text" inputMode="decimal" className="no-spin"
                                  value={cadSkuPvMargen} placeholder="0"
                                  onChange={e => { setCadSkuPvMargen(e.target.value); setCadSkuPvSaveMsg('') }}
                                  style={{ width: 80, border: '1px solid var(--border)', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.9rem', textAlign: 'right' }} />
                                <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>%</span>
                              </div>
                            </div>
                            <div className={`stat-box${margenNum !== 0 ? ' primary' : ''}`} style={{ margin: 0 }}>
                              <span className="stat-label">Precio de Venta</span>
                              <span className="stat-value">${fmt(pvCalc)}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Ajuste % s/ P. Venta</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                  <button onClick={() => setCadSkuPvAjusteSign('+')}
                                    style={{ padding: '0.3rem 0.55rem', background: cadSkuPvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: cadSkuPvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>▲ Subir</button>
                                  <button onClick={() => setCadSkuPvAjusteSign('-')}
                                    style={{ padding: '0.3rem 0.55rem', background: cadSkuPvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: cadSkuPvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>▼ Bajar</button>
                                </div>
                                <input type="text" inputMode="decimal" className="no-spin"
                                  value={cadSkuPvAjuste} placeholder="0"
                                  onChange={e => { setCadSkuPvAjuste(e.target.value.replace('-', '')); setCadSkuPvSaveMsg('') }}
                                  style={{ width: 64, border: '1px solid var(--border)', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.9rem', textAlign: 'right' }} />
                                <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>%</span>
                              </div>
                            </div>
                            {hayAjuste && (
                              <div className="stat-box warning" style={{ margin: 0 }}>
                                <span className="stat-label">Precio Final Ajustado</span>
                                <span className="stat-value">${fmt(pfCalc)}</span>
                              </div>
                            )}
                          </div>
                          {cadExplosion.pv_activo && (
                            <div style={{ background: '#edf7d4', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem', color: '#4a7c00' }}>
                              Override guardado: P. Venta = <strong>${fmt(cadExplosion.pv_precio_venta)}</strong>
                              {cadExplosion.pv_ajuste_pct !== 0 && <> → Ajustado = <strong>${fmt(cadExplosion.pv_precio_final)}</strong></>}
                              {' '}— usado como base en todas las vistas de cadenas
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button className="btn btn-primary btn-sm" onClick={saveCadSkuPV} disabled={cadSkuPvSaving || !cadSkuPvMargen}>
                              {cadSkuPvSaving ? 'Guardando…' : 'Grabar'}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => {
                              const aj = cadExplosion.pv_activo && cadExplosion.pv_ajuste_pct !== 0 ? cadExplosion.pv_ajuste_pct : 0
                              setCadSkuPvMargen(cadExplosion.pv_activo ? String(cadExplosion.pv_margen_pct) : '')
                              setCadSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
                              setCadSkuPvAjusteSign(aj < 0 ? '-' : '+')
                              setCadSkuPvSaveMsg('')
                            }}>Deshacer</button>
                            {cadExplosion.pv_activo && (
                              <button className="btn btn-danger btn-sm" onClick={resetCadSkuPV} disabled={cadSkuPvSaving}>Predeterminado</button>
                            )}
                            {cadSkuPvSaveMsg && (
                              <span style={{ fontSize: '0.82rem', color: cadSkuPvSaveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                                {cadSkuPvSaveMsg === 'Guardado' ? '✓ Guardado' : cadSkuPvSaveMsg === 'Restablecido' ? '✓ Restablecido' : cadSkuPvSaveMsg}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}

                    {!cadSku && !cadSkuLoading && (
                      <div className="empty-state">Busca un Producto Terminado para ver su costeo por cadena.</div>
                    )}
                    {cadSku && !cadSkuLoading && cadExplosion?.detail && (
                      <div className="alert alert-error">⚠️ {cadExplosion.detail}</div>
                    )}
                  </>
                )}

                {/* ─ SUB-MODO MASIVA ─ */}
                {cadenaMode === 'masivo' && (
                  <>
                    <div className="card" style={{ maxWidth: 1000, marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
                          <label>Cadena</label>
                          <select value={cadMasivClienteId}
                            onChange={e => { setCadMasivClienteId(Number(e.target.value)); setCadMasivResultados([]) }}
                            style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                            <option value={0}>— Selecciona una cadena —</option>
                            {clientes.map((cl: any) => <option key={cl.id} value={cl.id}>{cl.cliente}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
                          <label>Familia</label>
                          <select value={cadMasivFamilia} onChange={e => onCadFamiliaChange(e.target.value)}
                            style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                            <option value="">— Todas —</option>
                            {masivFamilias.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
                          <label>Subfamilia</label>
                          <select value={cadMasivSubfamilia} onChange={e => { setCadMasivSubfamilia(e.target.value); setCadMasivResultados([]) }}
                            style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem' }}>
                            <option value="">— Todas —</option>
                            {cadMasivSubfamilias.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ flex: '1 1 180px', margin: 0 }}>
                          <label>Buscar</label>
                          <input type="text" placeholder="SKU o nombre…" value={cadMasivSearch}
                            onChange={e => setCadMasivSearch(e.target.value)}
                            style={{ width: '100%', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                        </div>
                        <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}
                          onClick={loadCadMasivo} disabled={cadMasivLoading || !cadMasivClienteId}>
                          {cadMasivLoading ? 'Calculando…' : '🔎 Consultar'}
                        </button>
                        <button className="btn btn-ghost btn-sm"
                          disabled={cadMasivResultados.length === 0}
                          onClick={() => { setCadMasivResultados([]); setCadMasivFamilia(''); setCadMasivSubfamilia(''); setCadMasivSearch('') }}>
                          ✕ Limpiar
                        </button>
                      </div>
                    </div>

                    {/* Panel PV Masivo — Cadenas */}
                    {cadMasivResultados.length > 0 && (
                      <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--primary)', borderWidth: 1.5 }}>
                        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div className="fw-700 text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary-dark)', whiteSpace: 'nowrap' }}>
                            💰 Precio de Venta Masivo
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Margen %</label>
                            <input type="text" inputMode="decimal" className="no-spin"
                              value={cadMasivPvMargen} placeholder="Ej: 20"
                              onChange={e => { setCadMasivPvMargen(e.target.value); setCadMasivPvSaveMsg('') }}
                              style={{ width: 72, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85rem', textAlign: 'right' }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Ajuste %</label>
                            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                              <button onClick={() => setCadMasivPvAjusteSign('+')}
                                style={{ padding: '0.3rem 0.55rem', background: cadMasivPvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: cadMasivPvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>▲ Subir</button>
                              <button onClick={() => setCadMasivPvAjusteSign('-')}
                                style={{ padding: '0.3rem 0.55rem', background: cadMasivPvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: cadMasivPvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1 }}>▼ Bajar</button>
                            </div>
                            <input type="text" inputMode="decimal" className="no-spin"
                              value={cadMasivPvAjuste} placeholder="0"
                              onChange={e => { setCadMasivPvAjuste(e.target.value.replace('-', '')); setCadMasivPvSaveMsg('') }}
                              style={{ width: 56, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85rem', textAlign: 'right' }} />
                          </div>
                          {cadMasivPvMargen.trim() && (() => {
                            const m = parseFloat(cadMasivPvMargen.replace(',', '.')) || 0
                            const a = parseFloat(cadMasivPvAjuste.replace(',', '.')) || 0
                            const aS = cadMasivPvAjusteSign === '-' ? -a : a
                            const factor = (1 + m / 100) * (1 + aS / 100)
                            return <span style={{ fontSize: '0.75rem', color: 'var(--primary-dark)', fontWeight: 600, background: 'var(--primary-light)', borderRadius: 6, padding: '0.2rem 0.5rem' }}>×{factor.toFixed(3)} sobre costo parcial</span>
                          })()}
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                            {cadMasivResultados.filter((r: any) => (r.costo_parcial || 0) > 0).length} productos con costo
                          </span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button className="btn btn-primary btn-sm"
                              disabled={!cadMasivPvMargen.trim() || cadMasivPvSaving}
                              onClick={saveCadMasivoPV}>
                              {cadMasivPvSaving ? 'Guardando…' : 'Grabar'}
                            </button>
                            {cadMasivResultados.some((r: any) => r.pv_activo) && (
                              <button className="btn btn-ghost btn-sm" disabled={cadMasivPvSaving} onClick={resetCadMasivoPV}>Predeterminado</button>
                            )}
                            {cadMasivPvSaveMsg && (
                              <span style={{ fontSize: '0.78rem', color: cadMasivPvSaveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                                {cadMasivPvSaveMsg === 'Guardado' ? '✓ Guardado' : cadMasivPvSaveMsg === 'Restablecido' ? '✓ Restablecido' : cadMasivPvSaveMsg}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {cadMasivResultados.length > 0 && (() => {
                      const cadena = clientes.find((cl: any) => cl.id === cadMasivClienteId)
                      const filtrados = cadMasivSearch.trim()
                        ? cadMasivResultados.filter((r: any) => {
                            const q = cadMasivSearch.trim().toLowerCase()
                            return r.sku?.toLowerCase().includes(q) || r.nombre?.toLowerCase().includes(q)
                              || r.familia?.toLowerCase().includes(q)
                          })
                        : cadMasivResultados
                      return (
                        <div className="card">
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                            <span className="card-title" style={{ margin: 0 }}>
                              {filtrados.length} de {cadMasivResultados.length} productos
                            </span>
                            {cadena && <span className="badge badge-blue">{cadena.cliente}</span>}
                            {cadMasivFamilia && <span className="badge badge-gray">{cadMasivFamilia}</span>}
                            {cadMasivExplosion && <span className="text-muted text-xs">← Haz clic en otro producto para cambiar</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                            {/* Tabla */}
                            <div className="tbl-wrap" style={{ flex: cadMasivExplosion ? '0 0 520px' : '1' }}>
                              <table className="tbl">
                                <thead>
                                  <tr>
                                    <th>SKU</th>
                                    <th>Nombre</th>
                                    {!cadMasivExplosion && <th>Familia</th>}
                                    <th className="num">Costo BOM</th>
                                    <th className="num">Costo Parcial</th>
                                    <th className="num">P. Lista</th>
                                    <th className="num">P. Final</th>
                                    <th className="num">Mg Final</th>
                                    <th className="ctr">BOM</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filtrados.map((r: any) => {
                                    const mgColor   = r.mg_final_pct >= 10 ? 'var(--success)' : r.mg_final_pct >= 0 ? 'var(--warning)' : 'var(--danger)'
                                    const isSelected = cadMasivExplosion?.sku === r.sku
                                    return (
                                      <tr key={r.sku} onClick={() => loadCadMasivExplosion(r.sku, r.nombre)}
                                        style={{ cursor: 'pointer', background: isSelected ? 'var(--primary-light)' : '', borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent' }}>
                                        <td><span className="fw-600 text-xs" style={{ color: 'var(--primary)' }}>{r.sku}</span></td>
                                        <td style={{ maxWidth: cadMasivExplosion ? 160 : 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.nombre}>{r.nombre}</td>
                                        {!cadMasivExplosion && <td style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>{r.familia || '—'}</td>}
                                        <td className="num text-xs">{fmtCLP(r.costo_bom_clp)}</td>
                                        <td className="num text-xs">
                                          {fmtCLP(r.costo_parcial)}
                                          {r.pv_activo && <span className="badge badge-green" style={{ fontSize: '0.65rem', marginLeft: 4 }}>PV</span>}
                                        </td>
                                        <td className="num text-xs">{fmtCLP(r.precio_lista)}</td>
                                        <td className="num fw-600 text-xs">{fmtCLP(r.precio_final)}</td>
                                        <td className="num fw-700 text-xs" style={{ color: mgColor }}>{r.mg_final_pct.toFixed(1)}%</td>
                                        <td className="ctr">
                                          {r.tiene_bom ? r.insumos_sin_precio > 0
                                            ? <span className="badge badge-yellow">⚠ {r.insumos_sin_precio}</span>
                                            : <span className="badge badge-green">✓</span>
                                            : <span className="badge badge-red">Sin BOM</span>}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* Panel drill-down */}
                            {cadMasivExplosion && (() => {
                              const d    = cadMasivExplosion.data
                              const cRow = cadMasivResultados.find((r: any) => r.sku === cadMasivExplosion.sku)
                              const margenNum = parseFloat(cadMasivSkuPvMargen.replace(',', '.')) || 0
                              const absAj2    = parseFloat(cadMasivSkuPvAjuste.replace(',', '.')) || 0
                              const ajusteNum = cadMasivSkuPvAjusteSign === '-' ? -absAj2 : absAj2
                              const costoBase = cRow?.costo_parcial || d.costo_final_clp
                              const pvCalc    = costoBase * (1 + margenNum / 100)
                              const pfCalc    = pvCalc * (1 + ajusteNum / 100)
                              const hayAjuste = ajusteNum !== 0
                              return (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {/* Header */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <div>
                                      <div className="fw-700" style={{ fontSize: '0.9rem', color: 'var(--secondary)' }}>📦 {cadMasivExplosion.sku}</div>
                                      <div className="text-muted text-xs">{cadMasivExplosion.nombre}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <button className="btn btn-primary btn-sm" onClick={() => exportBomToExcel(cadMasivExplosion.sku, cadMasivExplosion.nombre, cadMasivExplosion.data)}>📥 Excel</button>
                                      <button className="btn btn-ghost btn-sm" onClick={() => setCadMasivExplosion(null)}>✕</button>
                                    </div>
                                  </div>

                                  {/* KPIs */}
                                  {cRow && (
                                    <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
                                      {[
                                        { label: 'Costo Parcial', val: fmtCLP(cRow.costo_parcial), cls: '' },
                                        { label: 'Precio Lista',  val: fmtCLP(cRow.precio_lista),  cls: '' },
                                        { label: 'Precio Final',  val: fmtCLP(cRow.precio_final),  cls: 'primary' },
                                        { label: 'Utilidad',      val: fmtCLP(cRow.utilidad),      cls: cRow.utilidad >= 0 ? 'success' : 'danger' },
                                        { label: 'Mg Final',      val: cRow.mg_final_pct.toFixed(1) + '%', cls: cRow.mg_final_pct >= 10 ? 'success' : cRow.mg_final_pct >= 0 ? 'warning' : 'danger' },
                                      ].map(k => (
                                        <div key={k.label} className={`stat-box${k.cls ? ' ' + k.cls : ''}`} style={{ flex: '1 1 90px', minWidth: 90, margin: 0 }}>
                                          <span className="stat-label">{k.label}</span>
                                          <span className="stat-value">{k.val}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Desglose de costos — igual a Por SKU cadena */}
                                  {cRow && (() => {
                                    const bomBruto   = (d.costo_mp_clp || 0) + (d.costo_insumos_clp || 0)
                                    const bomMerma   = d.costo_total_con_merma || 0
                                    const mermaDelta = bomMerma - bomBruto
                                    const mermaFac   = d.merma_factor || 1
                                    const leyRep     = cRow.ley_rep_clp || d.ley_rep_clp || 0
                                    const disp       = d.disposicion_clp || 0
                                    const gtos       = d.gtos_indirectos_clp || 0
                                    const flete      = cRow.flete_clp || 0
                                    const pallet     = cRow.pallet_clp || 0
                                    const cParcial   = cRow.costo_parcial || 0
                                    const plb        = cRow.precio_lista || 0
                                    const pFinal     = cRow.precio_final || 0
                                    const comision   = cRow.comision_monto || 0
                                    const planCom    = cRow.plan_monto || 0
                                    const utilidad   = cRow.utilidad || 0
                                    const factor     = cParcial > 0 ? plb / cParcial : 1
                                    const descuento  = plb - pFinal

                                    type RowType = { label?: string; val?: string; indent?: boolean; bold?: boolean; subtotal?: boolean; color?: string; section?: string }
                                    const desRows: RowType[] = [
                                      { section: '— ESTRUCTURA DE COSTO —' },
                                      { label: 'Materias Primas',       val: fmtCLP(d.costo_mp_clp || 0),     indent: true },
                                      { label: 'Packaging / Insumos',   val: fmtCLP(d.costo_insumos_clp || 0), indent: true },
                                      { label: '= BOM Bruto',           val: fmtCLP(bomBruto),                 subtotal: true },
                                      ...(mermaFac > 1 ? [
                                        { label: `(+) Merma ×${mermaFac.toFixed(3)}`, val: `+${fmtCLP(mermaDelta)}`, indent: true, color: '#d97706' },
                                        { label: '= BOM c/ Merma',      val: fmtCLP(bomMerma),                 subtotal: true },
                                      ] : []),
                                      { label: '(+) Ley REP',           val: `+${fmtCLP(leyRep)}`,  indent: true, color: 'var(--text-2)' },
                                      { label: '(+) Disposición',       val: `+${fmtCLP(disp)}`,    indent: true, color: 'var(--text-2)' },
                                      { label: '(+) Gastos Indirectos', val: `+${fmtCLP(gtos)}`,    indent: true, color: 'var(--text-2)' },
                                      { label: '(+) Flete',             val: `+${fmtCLP(flete)}`,   indent: true, color: 'var(--text-2)' },
                                      ...(pallet > 0 ? [{ label: '(+) Pallet', val: `+${fmtCLP(pallet)}`, indent: true, color: 'var(--text-2)' }] : []),
                                      { label: '= Costo Parcial',       val: fmtCLP(cParcial),                 bold: true, subtotal: true },
                                      { section: '— CASCADA DE PRECIO —' },
                                      { label: `× Factor (×${factor.toFixed(3)})`, val: fmtCLP(plb), indent: true, color: 'var(--info)' },
                                      { label: '= Precio Lista (PLB)',  val: fmtCLP(plb),                      bold: true, subtotal: true },
                                      ...(descuento > 0 ? [{ label: '(-) Descuento comercial', val: `-${fmtCLP(descuento)}`, indent: true, color: '#dc2626' }] : []),
                                      { label: '= Precio Final',        val: fmtCLP(pFinal),                   bold: true, subtotal: true, color: '#16a34a' },
                                      { section: '— RESULTADO —' },
                                      ...(comision > 0 ? [{ label: '(-) Comisión',       val: `-${fmtCLP(comision)}`, indent: true, color: '#dc2626' }] : []),
                                      ...(planCom  > 0 ? [{ label: '(-) Plan Comercial', val: `-${fmtCLP(planCom)}`,  indent: true, color: '#dc2626' }] : []),
                                      { label: '= Utilidad Neta',       val: fmtCLP(utilidad),                 bold: true, subtotal: true, color: utilidad >= 0 ? '#16a34a' : '#dc2626' },
                                    ]
                                    return (
                                      <div style={{ background: '#f8faf4', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.81rem' }}>
                                        <div style={{ fontWeight: 600, marginBottom: '0.6rem', color: 'var(--text-2)' }}>Desglose de costos</div>
                                        {desRows.map((row, i) => row.section
                                          ? <div key={i} style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', padding: '6px 0 2px', marginTop: i > 0 ? 4 : 0 }}>{row.section}</div>
                                          : (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: row.subtotal ? '4px 0' : '2px 0', borderBottom: row.subtotal ? '1px solid var(--border)' : undefined, fontWeight: row.bold ? 700 : 400 }}>
                                              <span style={{ color: 'var(--text-2)', paddingLeft: row.indent ? '0.8rem' : 0 }}>{row.label}</span>
                                              <span style={{ color: row.color || (row.bold ? 'var(--secondary)' : '#444'), fontVariantNumeric: 'tabular-nums' }}>{row.val}</span>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    )
                                  })()}

                                  {/* Detalle insumos */}
                                  <div className="tbl-wrap">
                                    <table className="tbl">
                                      <thead>
                                        <tr>
                                          <th>Código</th><th>Materia Prima</th>
                                          <th className="num">Cantidad</th>
                                          <th className="num">Unit. CLP</th>
                                          <th className="ctr">Fuente</th>
                                          <th className="num">Sub. CLP</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        <TablaInsumos insumos={d.detalle_insumos || []} />
                                      </tbody>
                                    </table>
                                  </div>

                                  {/* Panel PV por producto */}
                                  {costoBase > 0 && (
                                    <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: 8, border: d.pv_activo ? '2px solid var(--primary)' : '1px solid var(--border)', background: d.pv_activo ? 'var(--primary-light)' : '#fafafa' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                        <span className="fw-700 text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary-dark)' }}>💰 Precio de Venta</span>
                                        {d.pv_activo && <span className="badge badge-green">Override activo</span>}
                                      </div>
                                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
                                        <div className="stat-box" style={{ margin: 0 }}>
                                          <span className="stat-label">Costo Final</span>
                                          <span className="stat-value">${fmt(costoBase)}</span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Margen %</span>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <input type="text" inputMode="decimal" className="no-spin"
                                              value={cadMasivSkuPvMargen} placeholder="0"
                                              onChange={e => { setCadMasivSkuPvMargen(e.target.value); setCadMasivSkuPvSaveMsg('') }}
                                              style={{ width: 64, border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.4rem', fontSize: '0.85rem', textAlign: 'right' }} />
                                            <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>%</span>
                                          </div>
                                        </div>
                                        <div className={`stat-box${margenNum !== 0 ? ' primary' : ''}`} style={{ margin: 0 }}>
                                          <span className="stat-label">Precio de Venta</span>
                                          <span className="stat-value">${fmt(pvCalc)}</span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase' }}>Ajuste %</span>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                              <button onClick={() => setCadMasivSkuPvAjusteSign('+')}
                                                style={{ padding: '0.2rem 0.4rem', background: cadMasivSkuPvAjusteSign === '+' ? 'var(--success)' : 'var(--bg-subtle)', color: cadMasivSkuPvAjusteSign === '+' ? 'white' : '#555', border: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>▲</button>
                                              <button onClick={() => setCadMasivSkuPvAjusteSign('-')}
                                                style={{ padding: '0.2rem 0.4rem', background: cadMasivSkuPvAjusteSign === '-' ? 'var(--danger)' : 'var(--bg-subtle)', color: cadMasivSkuPvAjusteSign === '-' ? 'white' : '#555', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>▼</button>
                                            </div>
                                            <input type="text" inputMode="decimal" className="no-spin"
                                              value={cadMasivSkuPvAjuste} placeholder="0"
                                              onChange={e => { setCadMasivSkuPvAjuste(e.target.value.replace('-', '')); setCadMasivSkuPvSaveMsg('') }}
                                              style={{ width: 52, border: '1px solid var(--border)', borderRadius: 4, padding: '0.25rem 0.4rem', fontSize: '0.85rem', textAlign: 'right' }} />
                                            <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>%</span>
                                          </div>
                                        </div>
                                        {hayAjuste && (
                                          <div className="stat-box warning" style={{ margin: 0 }}>
                                            <span className="stat-label">Precio Ajustado</span>
                                            <span className="stat-value">${fmt(pfCalc)}</span>
                                          </div>
                                        )}
                                      </div>
                                      {d.pv_activo && (
                                        <div style={{ background: '#d4edda', borderRadius: 6, padding: '0.35rem 0.6rem', marginBottom: '0.5rem', fontSize: '0.78rem', color: '#1a6b30' }}>
                                          Guardado: P. Venta = <strong>${fmt(d.pv_precio_venta)}</strong>
                                          {d.pv_ajuste_pct !== 0 && <> → Ajustado = <strong>${fmt(d.pv_precio_final)}</strong></>}
                                        </div>
                                      )}
                                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <button className="btn btn-primary btn-sm" onClick={saveCadMasivSkuPV} disabled={cadMasivSkuPvSaving || !cadMasivSkuPvMargen}>
                                          {cadMasivSkuPvSaving ? 'Guardando…' : 'Grabar'}
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => {
                                          const aj = d.pv_activo && d.pv_ajuste_pct !== 0 ? d.pv_ajuste_pct : 0
                                          setCadMasivSkuPvMargen(d.pv_activo ? String(d.pv_margen_pct) : '')
                                          setCadMasivSkuPvAjuste(aj !== 0 ? String(Math.abs(aj)) : '')
                                          setCadMasivSkuPvAjusteSign(aj < 0 ? '-' : '+')
                                          setCadMasivSkuPvSaveMsg('')
                                        }}>Deshacer</button>
                                        {d.pv_activo && (
                                          <button className="btn btn-danger btn-sm" onClick={resetCadMasivSkuPV} disabled={cadMasivSkuPvSaving}>Predeterminado</button>
                                        )}
                                        {cadMasivSkuPvSaveMsg && (
                                          <span style={{ fontSize: '0.78rem', color: cadMasivSkuPvSaveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                                            {cadMasivSkuPvSaveMsg === 'Guardado' ? '✓ Guardado' : cadMasivSkuPvSaveMsg === 'Restablecido' ? '✓ Restablecido' : cadMasivSkuPvSaveMsg}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      )
                    })()}

                    {cadMasivResultados.length === 0 && !cadMasivLoading && (
                      <div className="empty-state">
                        {!cadMasivClienteId
                          ? 'Selecciona una cadena y presiona Consultar.'
                          : 'Presiona Consultar para ver los costos de esta cadena.'}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* SIMULADOR DESDE COSTO BASE */}
            {consultaMode === 'base' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Búsqueda + costo base */}
                <div className="card">
                  <div className="card-title">🎯 Simulador desde Costo Base</div>
                  <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: '1rem' }}>
                    Ingresa un costo base personalizado y calcula el precio de venta por cadena usando los parámetros de la BD (editables abajo).
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 260px' }}>
                      <label className="field-label">Producto Terminado</label>
                      <div className="sb-input-wrap" style={{ position: 'relative' }}>
                        <input type="text" className="searchbar" placeholder="Buscar SKU o nombre…"
                          value={baseSearch} onChange={e => { searchBaseSku(e.target.value); acBase.reset() }}
                          onKeyDown={e => acBase.onKeyDown(e, baseSug.length, () => { const s = baseSug[acBase.idx]; if (s) selectBaseSku(s.sku, s.nombre) })} />
                        {baseSug.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {baseSug.map((s: any, i: number) => (
                              <div key={s.sku} className={`autocomplete-item${i === acBase.idx ? ' active' : ''}`}
                                onClick={() => selectBaseSku(s.sku, s.nombre)}>
                                <span className="fw-600">{s.sku}</span> — {s.nombre}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 200px' }}>
                      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        Costo Base (CLP)
                        {baseSku && baseCosto && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--primary-dark)', fontWeight: 600, background: 'var(--primary-light)', borderRadius: 4, padding: '1px 5px' }}>
                            Real: ${fmt(parseFloat(baseCosto) || 0, 0)}
                          </span>
                        )}
                      </label>
                      <input type="number" min="0" placeholder="Ej: 25000"
                        value={baseCosto} onChange={e => setBaseCosto(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1.5px solid ${baseSku ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, fontSize: '0.9rem', background: baseSku ? 'var(--primary-light)' : 'white' }} />
                      {baseSku && <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: 2 }}>Precargado · edita para simular otro costo</div>}
                    </div>
                    <button className="btn btn-primary" onClick={calcularPrecioDesdeBase}
                      disabled={!baseSku || !baseCosto || baseLoading}>
                      {baseLoading ? 'Calculando…' : '⚡ Calcular precios'}
                    </button>
                    {(baseSku || baseCosto) && (
                      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}
                        onClick={() => { setBaseSearch(''); setBaseSku(''); setBaseNombre(''); setBaseCosto(''); setBaseSug([]); setBaseResult(null); setBaseParams(null) }}>
                        ✕ Limpiar
                      </button>
                    )}
                  </div>

                  {baseSku && baseResult && (
                    <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem', background: 'var(--primary-light)', borderRadius: 6, fontSize: '0.82rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                      <span><span className="text-muted">SKU: </span><strong>{baseResult.sku}</strong></span>
                      <span><span className="text-muted">Formato: </span>{baseResult.unidad}</span>
                      <span><span className="text-muted">Peso: </span>{baseResult.peso_kg} kg</span>
                      <span><span className="text-muted">BOM actual: </span><strong>${fmt(baseResult.costo_bom_ref)}</strong></span>
                    </div>
                  )}
                </div>

                {/* Parámetros globales editables */}
                {baseParams && (
                  <div className="card">
                    <div className="card-title" style={{ fontSize: '0.9rem' }}>Parámetros de Cálculo</div>
                    <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                      Pre-cargados desde la BD. Modifícalos para simular escenarios distintos sin afectar la configuración global.
                    </p>
                    <div className="form-grid cols-4" style={{ gap: '0.75rem' }}>
                      <div className="field">
                        <label className="field-label">Merma (factor)</label>
                        <input type="number" step="0.01" min="1" value={baseParams!.merma_factor}
                          onChange={e => setBaseParams({ ...baseParams!, merma_factor: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>ej: 1.05 = 5% merma</span>
                      </div>
                      <div className="field">
                        <label className="field-label">Flete base (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.flete_base_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, flete_base_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Pallet base (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.pallet_base_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, pallet_base_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Ley REP (CLP)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.ley_rep_clp}
                          placeholder="Auto"
                          onChange={e => setBaseParams({ ...baseParams!, ley_rep_clp: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>Vacío o 0 = jerarquía automática</span>
                      </div>
                      <div className="field">
                        <label className="field-label">Disposición (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.disposicion_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, disposicion_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Gtos Indirectos (%)</label>
                        <input type="number" step="0.001" min="0" max="1" value={baseParams!.gastos_indirectos}
                          onChange={e => setBaseParams({ ...baseParams!, gastos_indirectos: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>ej: 0.05 = 5%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Resultados */}
                {baseResult && (() => {
                  const d = baseResult.desglose_base
                  const cadenas: any[] = baseResult.cadenas || []
                  return (
                    <>
                      {/* Desglose base */}
                      <div className="card">
                        <div className="card-title" style={{ fontSize: '0.9rem' }}>Desglose de Costos Base</div>
                        <div className="stat-row">
                          <div className="stat-box">
                            <span className="stat-label">Costo base ingresado</span>
                            <span className="stat-value">${fmt(d.costo_base)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Merma ({d.merma_factor}×)</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.merma_monto)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">= Con merma</span>
                            <span className="stat-value">${fmt(d.costo_con_merma)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Flete base</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.flete_base)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Ley REP</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.ley_rep)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Disposición</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.disposicion)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Gtos Indirectos</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.gtos_indirectos)}</span>
                          </div>
                          <div className="stat-box primary">
                            <span className="stat-label">Costo Parcial Base</span>
                            <span className="stat-value">${fmt(d.costo_parcial_base)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Tabla por cadena */}
                      <div className="card" style={{ padding: 0 }}>
                        <div style={{ padding: '0.9rem 1.1rem 0.6rem', borderBottom: '1px solid var(--border)' }}>
                          <div className="card-title" style={{ fontSize: '0.9rem', marginBottom: 0 }}>Precios por Cadena</div>
                          <p className="text-muted text-sm" style={{ margin: '0.2rem 0 0' }}>
                            Haz clic en una fila para ver el desglose completo de esa cadena.
                          </p>
                        </div>
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Cadena</th>
                                <th className="num">Flete+Pallet</th>
                                <th className="num">Costo Parcial</th>
                                <th className="num">Factor</th>
                                <th className="num">Precio Lista</th>
                                <th className="num">Desc.</th>
                                <th className="num">Precio Final</th>
                                <th className="num">Costo Total</th>
                                <th className="ctr">Mg Lista</th>
                                <th className="ctr">Mg Final</th>
                                <th className="num">Utilidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cadenas.map((c: any) => {
                                const mgOk = c.mg_final_pct >= 10
                                const expanded = baseExpandRow === c.cliente_id
                                return (
                                  <>
                                    <tr key={c.cliente_id}
                                      onClick={() => setBaseExpandRow(expanded ? null : c.cliente_id)}
                                      style={{ cursor: 'pointer', background: expanded ? 'var(--primary-light)' : undefined }}>
                                      <td><span className="fw-600">{c.cliente}</span></td>
                                      <td className="num text-muted">${fmt(c.flete_cadena + c.pallet_cadena)}</td>
                                      <td className="num">${fmt(c.costo_parcial)}</td>
                                      <td className="num text-muted">{c.factor}×</td>
                                      <td className="num">${fmt(c.precio_lista)}</td>
                                      <td className="num text-muted">{(c.descuento_max * 100).toFixed(1)}%</td>
                                      <td className="num fw-600" style={{ color: 'var(--primary-dark)' }}>${fmt(c.precio_final)}</td>
                                      <td className="num text-muted">${fmt(c.costo_total)}</td>
                                      <td className="ctr">
                                        <span className={`badge ${c.mg_lista_pct >= 10 ? 'badge-blue' : 'badge-yellow'}`}>{c.mg_lista_pct.toFixed(1)}%</span>
                                      </td>
                                      <td className="ctr">
                                        <span className={`badge ${mgOk ? 'badge-green' : 'badge-red'}`}>{c.mg_final_pct.toFixed(1)}%</span>
                                      </td>
                                      <td className="num fw-600" style={{ color: mgOk ? 'var(--success)' : 'var(--danger)' }}>${fmt(c.utilidad)}</td>
                                    </tr>
                                    {expanded && (
                                      <tr key={`${c.cliente_id}-det`} style={{ background: '#f9fdf0' }}>
                                        <td colSpan={11} style={{ padding: '0.75rem 1.25rem' }}>
                                          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Logística cadena</div>
                                              <div>Flete: <strong>${fmt(c.flete_cadena)}</strong></div>
                                              <div>Pallet: <strong>${fmt(c.pallet_cadena)}</strong></div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Precio</div>
                                              <div>Costo parcial: <strong>${fmt(c.costo_parcial)}</strong></div>
                                              <div>× Factor {c.factor} = <strong>${fmt(c.precio_lista)}</strong> lista</div>
                                              <div>− Descuento {(c.descuento_max*100).toFixed(1)}% = <strong>${fmt(c.precio_final)}</strong> final</div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Plan comercial ({c.plan_comercial_pct.toFixed(2)}%)</div>
                                              <div>Comisión ({c.comision_pct.toFixed(1)}%): <strong>${fmt(c.comision_monto)}</strong></div>
                                              <div>Plan: <strong>${fmt(c.plan_comercial_monto)}</strong></div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Resultado</div>
                                              <div>Costo total: <strong>${fmt(c.costo_total)}</strong></div>
                                              <div>Utilidad: <strong style={{ color: c.utilidad > 0 ? 'var(--success)' : 'var(--danger)' }}>${fmt(c.utilidad)}</strong></div>
                                              <div>Margen final: <strong>{c.mg_final_pct.toFixed(2)}%</strong></div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

          </>
        )}
        {/* ===== COSTOS MANUALES ===== */}
        {view === 'manuales' && (
          <div className="card">
            <div className="card-title" style={{ justifyContent: 'space-between' }}>
              <span>Insumos sin precio ({sinPrecio.length})</span>
              <button className="btn btn-ghost btn-sm" onClick={loadSinPrecio}>↺ Actualizar</button>
            </div>

            {manualMsg && (
              <div className={`alert ${manualMsg.startsWith('Error') ? 'alert-error' : 'alert-success'}`}>
                {manualMsg}
              </div>
            )}

            {manualSku && (
              <div className="edit-panel">
                <div className="ep-title">Ingresar costo manual para: <strong>{manualSku}</strong></div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1, minWidth: 140 }}>
                    <label>Costo unitario (CLP)</label>
                    <input type="number" step="0.01" placeholder="Ej: 1500.00" value={manualCosto}
                      onChange={e => setManualCosto(e.target.value)} autoFocus />
                  </div>
                  <div className="field" style={{ flex: 2, minWidth: 200 }}>
                    <label>Notas (opcional)</label>
                    <input type="text" placeholder="Ej: Precio contrato 2025…" value={manualNota}
                      onChange={e => setManualNota(e.target.value)} />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={saveCostoManual}>Guardar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setManualSku(''); setManualCosto(''); setManualNota(''); setManualMsg('') }}>Cancelar</button>
                </div>
              </div>
            )}

            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th><th>Nombre</th><th className="ctr">U/M</th>
                    <th className="ctr">N° Recetas</th><th className="ctr">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {sinPrecio.map((item: any, i: number) => (
                    <tr key={i} style={manualSku === item.sku ? { background: '#eff6ff' } : {}}>
                      <td><span className="fw-600 text-xs" style={{ color: 'var(--primary)' }}>{item.sku}</span></td>
                      <td>{item.nombre}</td>
                      <td className="ctr text-muted text-xs">{item.unidad_medida}</td>
                      <td className="ctr">
                        <span className={`badge ${item.aparece_en_n_recetas > 20 ? 'badge-red' : item.aparece_en_n_recetas > 5 ? 'badge-yellow' : 'badge-gray'}`}>
                          {item.aparece_en_n_recetas}
                        </span>
                      </td>
                      <td className="ctr">
                        <button className="btn btn-primary btn-sm"
                          onClick={() => { setManualSku(item.sku); setManualCosto(''); setManualNota(''); setManualMsg('') }}>
                          + Precio
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!sinPrecio.length && <tr><td colSpan={5}><div className="empty-state">Todos los insumos tienen precio — ¡excelente!</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== HISTORIAL DE ESCENARIOS ===== */}
        {view === 'historial' && (() => {
          const histFiltrado = historial.filter((e: any) => {
            if (!e.created_at) return true
            const d = new Date(e.created_at)
            if (histFechaDesde && d < new Date(histFechaDesde)) return false
            if (histFechaHasta && d > new Date(histFechaHasta + 'T23:59:59')) return false
            return true
          })
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 1000 }}>
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--secondary)' }}>
                    Escenarios guardados ({histFiltrado.length}{histFiltrado.length !== historial.length ? ` / ${historial.length}` : ''})
                  </span>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Desde</label>
                    <input type="date" value={histFechaDesde} onChange={e => setHistFechaDesde(e.target.value)}
                      style={{ padding: '0.25rem 0.4rem', border: '1.5px solid var(--border)', borderRadius: 5, fontSize: '0.78rem' }} />
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>Hasta</label>
                    <input type="date" value={histFechaHasta} onChange={e => setHistFechaHasta(e.target.value)}
                      style={{ padding: '0.25rem 0.4rem', border: '1.5px solid var(--border)', borderRadius: 5, fontSize: '0.78rem' }} />
                    {(histFechaDesde || histFechaHasta) && (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setHistFechaDesde(''); setHistFechaHasta('') }}>✕ Limpiar</button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {histFiltrado.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => {
                      exportToExcel([{
                        name: 'Historial',
                        data: histFiltrado.map((e: any) => ({
                          'Nombre Escenario': e.nombre,
                          'SKU': e.sku || '',
                          'Producto': e.nombre_sku || '',
                          'Costo Original CLP': parseFloat(e.costo_original_clp) || 0,
                          'Costo Simulado CLP': parseFloat(e.costo_simulado_clp) || 0,
                          'Variación %': parseFloat(e.variacion_pct) || 0,
                          'Fecha': e.created_at ? new Date(e.created_at).toLocaleDateString('es-CL') : '',
                        }))
                      }], `Historial_Escenarios_${new Date().toISOString().slice(0,10)}.xlsx`)
                    }}>📥 Exportar Excel</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={loadHistorial} disabled={historialLoading}>↺ Actualizar</button>
                </div>
              </div>

              {historialLoading && <div className="tbl-wrap"><table className="tbl"><SkeletonTable rows={4} cols={6} /></table></div>}
              {!historialLoading && historial.length === 0 && (
                <div className="empty-state">Sin escenarios guardados. Corra una simulación y guárdela desde el Simulador de Recetas.</div>
              )}
              {!historialLoading && historial.length > 0 && (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th className="num">Costo Original CLP</th>
                        <th className="num">Costo Simulado CLP</th>
                        <th className="num">Variación %</th>
                        <th>Fecha</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {histFiltrado.map((e: any) => {
                        const pct = parseFloat(e.variacion_pct) || 0
                        return (
                          <tr key={e.id}>
                            <td style={{ fontWeight: 600 }}>{e.nombre}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-2)' }}>{e.sku || '—'}</td>
                            <td style={{ fontSize: '0.82rem' }}>{e.nombre_sku || '—'}</td>
                            <td className="num">${fmt(parseFloat(e.costo_original_clp) || 0)}</td>
                            <td className="num" style={{ fontWeight: 600 }}>${fmt(parseFloat(e.costo_simulado_clp) || 0)}</td>
                            <td className="num" style={{ color: pct > 0 ? 'var(--danger)' : pct < 0 ? 'var(--success)' : undefined, fontWeight: 700 }}>
                              {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                            </td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                              {e.created_at ? new Date(e.created_at).toLocaleDateString('es-CL') : '—'}
                            </td>
                            <td>
                              <button className="btn btn-danger btn-sm" onClick={() => {
                                confirmAction(`¿Eliminar escenario "${e.nombre}"?`, async () => {
                                  const r = await fetchWithAuth(`${API}/api/costos/escenarios-receta/${e.id}`, { method: 'DELETE' })
                                  if (r.ok) { toast('Escenario eliminado', 'info'); loadHistorial() }
                                  else toast('Error al eliminar', 'error')
                                })
                              }}>✕</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          )
        })()}

        {/* ===== ALERTAS DE VARIACIÓN ===== */}
        {view === 'alertas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 1000 }}>

            {/* Filtro umbral */}
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)' }}>Umbral mínimo de variación (%)</label>
                  <input type="number" min="0" max="100" step="1" value={alertasUmbral}
                    onChange={e => setAlertasUmbral(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadAlertas(alertasUmbral) }}
                    style={{ width: 100, padding: '0.42rem 0.65rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => loadAlertas(alertasUmbral)} disabled={alertasLoading}>
                  {alertasLoading ? 'Consultando…' : '🔍 Consultar'}
                </button>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-3)', alignSelf: 'center' }}>
                  Muestra insumos cuyo precio subió o bajó más del umbral entre las últimas dos compras registradas.
                </span>
              </div>
            </div>

            {/* Resultados */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--secondary)' }}>
                  {alertas.length > 0 ? `${alertas.length} insumo${alertas.length !== 1 ? 's' : ''} con variación ≥ ${alertasUmbral}%` : 'Sin alertas'}
                </span>
                {alertas.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    exportToExcel([{ name: 'Alertas', data: alertas.map(a => ({
                      'SKU': a.sku, 'Nombre': a.nombre, 'Unidad': a.unidad_medida,
                      'Costo Actual CLP': parseFloat(a.costo_actual) || 0,
                      'Costo Anterior CLP': parseFloat(a.costo_anterior) || 0,
                      'Variación %': parseFloat(a.variacion_pct) || 0,
                      'Fecha Actual': a.fecha_actual, 'Fecha Anterior': a.fecha_anterior,
                      'Afecta N° Productos': a.afecta_n_productos,
                    })) }], `Alertas_Variacion_${new Date().toISOString().slice(0,10)}.xlsx`)
                  }}>📥 Exportar Excel</button>
                )}
              </div>

              {alertasLoading && <div className="empty-state">Consultando variaciones…</div>}

              {!alertasLoading && alertas.length === 0 && (
                <div className="empty-state">Sin variaciones por encima del umbral, o presione Consultar para cargar.</div>
              )}

              {!alertasLoading && alertas.length > 0 && (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Alerta</th>
                        <th>SKU</th>
                        <th>Nombre</th>
                        <th>Unidad</th>
                        <th className="num">Costo Anterior</th>
                        <th className="num">Costo Actual</th>
                        <th className="num">Variación %</th>
                        <th>Fecha anterior</th>
                        <th>Fecha actual</th>
                        <th className="num">Afecta PT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertas.map((a, i) => {
                        const pct = parseFloat(a.variacion_pct) || 0
                        const sube = pct > 0
                        return (
                          <tr key={i} style={{ background: Math.abs(pct) >= 20 ? (sube ? '#fff5f5' : '#f0fdf4') : undefined }}>
                            <td>
                              <span className={`badge ${Math.abs(pct) >= 20 ? (sube ? 'badge-red' : 'badge-green') : (sube ? 'badge-yellow' : 'badge-green')}`}
                                style={{ fontSize: '0.72rem' }}>
                                {sube ? '▲ Sube' : '▼ Baja'}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-2)' }}>{a.sku}</td>
                            <td style={{ fontWeight: 500 }}>{a.nombre}</td>
                            <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{a.unidad_medida || '—'}</td>
                            <td className="num" style={{ color: 'var(--text-3)' }}>${fmt(parseFloat(a.costo_anterior) || 0, 2)}</td>
                            <td className="num" style={{ fontWeight: 600 }}>${fmt(parseFloat(a.costo_actual) || 0, 2)}</td>
                            <td className="num" style={{ fontWeight: 700, color: sube ? 'var(--danger)' : 'var(--success)' }}>
                              {sube ? '+' : ''}{pct.toFixed(1)}%
                            </td>
                            <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{a.fecha_anterior ? new Date(a.fecha_anterior).toLocaleDateString('es-CL') : '—'}</td>
                            <td style={{ fontSize: '0.82rem' }}>{a.fecha_actual ? new Date(a.fecha_actual).toLocaleDateString('es-CL') : '—'}</td>
                            <td className="num">
                              {a.afecta_n_productos > 0
                                ? <span className="badge badge-yellow" style={{ fontSize: '0.7rem' }}>{a.afecta_n_productos} PT</span>
                                : <span style={{ color: 'var(--text-3)' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== DASHBOARD EJECUTIVO ===== */}
        {view === 'dashboard' && (() => {
          const estado = (row: any): 'completo' | 'incompleto' | 'sin_bom' =>
            !row.tiene_bom ? 'sin_bom' : row.insumos_sin_precio > 0 ? 'incompleto' : 'completo'

          const familias = Array.from(new Set(dashData.map(r => r.familia).filter(Boolean))).sort() as string[]

          const filtrado = dashData.filter(r => {
            const matchFam = !dashFamilia || r.familia === dashFamilia
            const matchEst = !dashEstado || estado(r) === dashEstado
            const q = dashSearch.trim().toLowerCase()
            const matchQ = !q || r.sku?.toLowerCase().includes(q) || r.nombre?.toLowerCase().includes(q)
            return matchFam && matchEst && matchQ
          }).sort((a, b) => {
            const { col, dir } = dashSort
            const ordEst: Record<string, number> = { sin_bom: 0, incompleto: 1, completo: 2 }
            let cmp = 0
            if (col === 'estado')        cmp = ordEst[estado(a)] - ordEst[estado(b)]
            else if (col === 'nombre')   cmp = a.nombre.localeCompare(b.nombre)
            else if (col === 'familia')  cmp = (a.familia || '').localeCompare(b.familia || '')
            else if (col === 'costo')    cmp = (parseFloat(a.costo_final_clp) || 0) - (parseFloat(b.costo_final_clp) || 0)
            else if (col === 'terreno')  cmp = (parseFloat(a.precio_terreno_clp) || 0) - (parseFloat(b.precio_terreno_clp) || 0)
            else if (col === 'sinprecio') cmp = (a.insumos_sin_precio || 0) - (b.insumos_sin_precio || 0)
            return cmp * dir || a.nombre.localeCompare(b.nombre)
          })
          const toggleSort = (col: string) => { setDashSort(prev => prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }); setDashPage(1) }
          const sortIcon = (col: string) => dashSort.col === col ? (dashSort.dir === 1 ? ' ▲' : ' ▼') : ' ⇅'

          const dashTotalPages = Math.ceil(filtrado.length / DASH_PAGE_SIZE)
          const dashPageSafe = Math.min(dashPage, dashTotalPages || 1)
          const filtradoPaged = filtrado.slice((dashPageSafe - 1) * DASH_PAGE_SIZE, dashPageSafe * DASH_PAGE_SIZE)

          const total     = dashData.length
          const completos = dashData.filter(r => estado(r) === 'completo').length
          const incompl   = dashData.filter(r => estado(r) === 'incompleto').length
          const sinBom    = dashData.filter(r => estado(r) === 'sin_bom').length
          const cobertura = total > 0 ? Math.round((completos / total) * 100) : 0

          // Resumen por familia
          const porFamilia: Record<string, { completo: number; incompleto: number; sin_bom: number; total: number }> = {}
          dashData.forEach(r => {
            const fam = r.familia || '(Sin familia)'
            if (!porFamilia[fam]) porFamilia[fam] = { completo: 0, incompleto: 0, sin_bom: 0, total: 0 }
            porFamilia[fam][estado(r)]++
            porFamilia[fam].total++
          })

          const badgeEst = { completo: 'badge-green', incompleto: 'badge-yellow', sin_bom: 'badge-red' }
          const labelEst = { completo: 'Completo', incompleto: 'Incompleto', sin_bom: 'Sin BOM' }

          const kpiCards = [
            { label: 'Total PT',      val: total,           icon: '📦', accent: '#2A2B2A', bg: '#f8faf4', valColor: '#2A2B2A' },
            { label: 'BOM Completo',  val: completos,        icon: '✅', accent: '#16a34a', bg: '#f0fdf4', valColor: '#16a34a' },
            { label: 'BOM Incompleto',val: incompl,          icon: '⚠️', accent: '#d97706', bg: '#fffbeb', valColor: '#d97706' },
            { label: 'Sin BOM',       val: sinBom,           icon: '❌', accent: '#dc2626', bg: '#fff5f5', valColor: '#dc2626' },
            { label: 'Cobertura BOM', val: `${cobertura}%`,  icon: '📊',
              accent: cobertura >= 80 ? '#16a34a' : cobertura >= 50 ? '#d97706' : '#dc2626',
              bg:     cobertura >= 80 ? '#f0fdf4' : cobertura >= 50 ? '#fffbeb' : '#fff5f5',
              valColor: cobertura >= 80 ? '#16a34a' : cobertura >= 50 ? '#d97706' : '#dc2626' },
          ]

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1280 }}>

              {/* KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.85rem' }}>
                {kpiCards.map(s => (
                  <div key={s.label} style={{
                    background: s.bg,
                    border: `1px solid ${s.accent}33`,
                    borderLeft: `4px solid ${s.accent}`,
                    borderRadius: 10,
                    padding: '1rem 1.1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.2rem',
                  }}>
                    <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{s.icon}</span>
                    <span style={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.1, color: s.valColor, letterSpacing: '-0.02em' }}>
                      {dashLoading ? '…' : s.val}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Cobertura por Familia */}
              {!dashLoading && Object.keys(porFamilia).length > 0 && (
                <div className="card" style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.85rem' }}>
                    Cobertura por Familia
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem' }}>
                    {Object.entries(porFamilia).sort(([a], [b]) => a.localeCompare(b)).map(([fam, cnt]) => {
                      const pct = Math.round((cnt.completo / cnt.total) * 100)
                      const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
                      const active = dashFamilia === fam
                      return (
                        <div key={fam} onClick={() => setDashFamilia(active ? '' : fam)}
                          style={{
                            background: active ? 'var(--primary-light)' : '#fafafa',
                            border: `1.5px solid ${active ? 'var(--primary)' : '#e5e7eb'}`,
                            borderRadius: 8, padding: '0.65rem 0.85rem', cursor: 'pointer',
                            transition: 'border-color 0.15s, background 0.15s',
                          }}>
                          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--secondary)', marginBottom: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fam}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                            <div style={{ flex: 1, height: 7, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color, minWidth: 34, textAlign: 'right' }}>{pct}%</span>
                          </div>
                          <div style={{ fontSize: '0.67rem', color: 'var(--text-3)', display: 'flex', gap: '0.4rem' }}>
                            <span style={{ color: '#16a34a' }}>✅ {cnt.completo}</span>
                            <span style={{ color: '#d97706' }}>⚠️ {cnt.incompleto}</span>
                            <span style={{ color: '#dc2626' }}>❌ {cnt.sin_bom}</span>
                            <span style={{ color: 'var(--text-3)' }}>/ {cnt.total}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Filtros + tabla */}
              <div className="card" style={{ padding: 0 }}>
                {/* Header con filtros */}
                <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--secondary)', flex: '1 1 auto' }}>
                    {filtrado.length} producto{filtrado.length !== 1 ? 's' : ''}
                    {(dashFamilia || dashEstado || dashSearch) ? ' (filtrado)' : ''}
                  </span>
                  <input type="text" placeholder="Buscar SKU o nombre…" value={dashSearch}
                    onChange={e => { setDashSearch(e.target.value); setDashPage(1) }}
                    style={{ padding: '0.35rem 0.6rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.82rem', minWidth: 180 }} />
                  <select value={dashFamilia} onChange={e => { setDashFamilia(e.target.value); setDashPage(1) }}
                    style={{ padding: '0.35rem 0.6rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.82rem', background: '#fff' }}>
                    <option value="">Todas las familias</option>
                    {familias.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select value={dashEstado} onChange={e => { setDashEstado(e.target.value); setDashPage(1) }}
                    style={{ padding: '0.35rem 0.6rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.82rem', background: '#fff' }}>
                    <option value="">Todos los estados</option>
                    <option value="completo">✅ Completo</option>
                    <option value="incompleto">⚠️ Incompleto</option>
                    <option value="sin_bom">❌ Sin BOM</option>
                  </select>
                  {(dashFamilia || dashEstado || dashSearch) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => { setDashFamilia(''); setDashEstado(''); setDashSearch('') }}>✕ Limpiar</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={loadDashboard} disabled={dashLoading}>↺ Actualizar</button>
                  {filtrado.length > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      const data = filtrado.map(r => ({
                        'Estado': !r.tiene_bom ? 'Sin BOM' : r.insumos_sin_precio > 0 ? 'Incompleto' : 'Completo',
                        'SKU': r.sku,
                        'Nombre': r.nombre,
                        'Familia': r.familia || '',
                        'Subfamilia': r.subfamilia || '',
                        'Insumos sin precio': r.insumos_sin_precio,
                        'Costo Final CLP': parseFloat(r.costo_final_clp) || 0,
                        'Costo MP CLP': parseFloat(r.costo_mp_clp) || 0,
                        'Costo Insumos CLP': parseFloat(r.costo_insumos_clp) || 0,
                        'Gastos Adicionales CLP': parseFloat(r.gastos_adicionales_clp) || 0,
                        'Precio Terreno CLP': parseFloat(r.precio_terreno_clp) || 0,
                      }))
                      exportToExcel([{ name: 'Dashboard', data }], `Dashboard_Passol_${new Date().toISOString().slice(0, 10)}.xlsx`)
                    }}>
                      📥 Excel simple
                    </button>
                  )}
                  {dashData.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => exportReporteEjecutivo(dashData)}>
                      📊 Reporte Ejecutivo
                    </button>
                  )}
                </div>

                {dashLoading && (<><SkeletonCards n={4} /><div className="tbl-wrap"><table className="tbl"><SkeletonTable rows={8} cols={6} /></table></div></>)}

                {!dashLoading && dashData.length === 0 && (
                  <div className="empty-state">Sin datos. Verifique que el servidor esté activo.</div>
                )}

                {!dashLoading && filtrado.length === 0 && dashData.length > 0 && (
                  <div className="empty-state">Sin resultados para los filtros aplicados.</div>
                )}

                {!dashLoading && filtrado.length > 0 && (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          {([
                            { label: 'Estado',         col: 'estado',    cls: '' },
                            { label: 'SKU',            col: '',          cls: '' },
                            { label: 'Nombre',         col: 'nombre',    cls: '' },
                            { label: 'Familia',        col: 'familia',   cls: '' },
                            { label: 'Subfamilia',     col: '',          cls: '' },
                            { label: 'Sin precio',     col: 'sinprecio', cls: 'num' },
                            { label: 'Costo Final CLP',col: 'costo',     cls: 'num' },
                            { label: 'P. Terreno CLP', col: 'terreno',   cls: 'num' },
                          ] as { label: string; col: string; cls: string }[]).map(h => (
                            <th key={h.label} className={h.cls}
                              onClick={h.col ? () => toggleSort(h.col) : undefined}
                              style={h.col ? { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' } : undefined}>
                              {h.label}{h.col ? sortIcon(h.col) : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtradoPaged.map((row, i) => {
                          const est = estado(row)
                          const costo = parseFloat(row.costo_final_clp) || 0
                          const terreno = parseFloat(row.precio_terreno_clp) || 0
                          return (
                            <tr key={i} style={est === 'sin_bom' ? { background: '#fff5f5' } : est === 'incompleto' ? { background: '#fffbeb' } : undefined}>
                              <td>
                                <span className={`badge ${badgeEst[est]}`} style={{ fontSize: '0.72rem' }}>
                                  {labelEst[est]}
                                </span>
                              </td>
                              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-2)', cursor: 'copy' }} title="Copiar SKU" onClick={() => copyToClipboard(row.sku)}>{row.sku}</td>
                              <td style={{ fontWeight: 500 }}>{row.nombre}</td>
                              <td style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{row.familia || '—'}</td>
                              <td style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{row.subfamilia || '—'}</td>
                              <td className="num">
                                {row.insumos_sin_precio > 0
                                  ? <span className="badge badge-red" style={{ fontSize: '0.7rem' }}>{row.insumos_sin_precio}</span>
                                  : <span style={{ color: '#16a34a', fontSize: '0.8rem' }}>—</span>}
                              </td>
                              <td className="num" style={{ fontWeight: 600, color: costo === 0 ? '#dc2626' : undefined }}>
                                {costo === 0 ? '—' : `$${fmt(costo)}`}
                              </td>
                              <td className="num" style={{ color: 'var(--info)' }}>
                                {terreno === 0 ? '—' : `$${fmt(terreno)}`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Controles de paginación */}
                {!dashLoading && filtrado.length > DASH_PAGE_SIZE && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 1.1rem', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                      Mostrando {((dashPageSafe - 1) * DASH_PAGE_SIZE) + 1}–{Math.min(dashPageSafe * DASH_PAGE_SIZE, filtrado.length)} de {filtrado.length}
                    </span>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDashPage(1)} disabled={dashPageSafe === 1}>«</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDashPage(p => Math.max(1, p - 1))} disabled={dashPageSafe === 1}>‹ Anterior</button>
                      <span style={{ fontSize: '0.78rem', padding: '0 0.5rem', color: 'var(--text-2)', fontWeight: 600 }}>
                        Pág. {dashPageSafe} / {dashTotalPages}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDashPage(p => Math.min(dashTotalPages, p + 1))} disabled={dashPageSafe === dashTotalPages}>Siguiente ›</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDashPage(dashTotalPages)} disabled={dashPageSafe === dashTotalPages}>»</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* ===== CONSULTA MATERIAS PRIMAS ===== */}
        {view === 'mp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 1100 }}>

            {/* Filtros */}
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>

                {/* Buscador */}
                <div className="field" style={{ flex: '1 1 220px', minWidth: 180, marginBottom: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)' }}>Buscar</label>
                  <input
                    type="text"
                    placeholder="SKU o nombre…"
                    value={mpSearch}
                    onChange={e => setMpSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadMpList(mpSearch, mpTipo, mpFuente) }}
                    style={{ width: '100%', padding: '0.42rem 0.65rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }}
                  />
                </div>

                {/* Tipo */}
                <div className="field" style={{ flex: '0 0 150px', marginBottom: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)' }}>Tipo</label>
                  <select value={mpTipo} onChange={e => { setMpTipo(e.target.value); loadMpList(mpSearch, e.target.value, mpFuente) }}
                    style={{ width: '100%', padding: '0.42rem 0.65rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem', background: '#fff' }}>
                    <option value="">Todos</option>
                    <option value="Insumo">Insumo</option>
                    <option value="Sub-receta">Sub-receta</option>
                  </select>
                </div>

                {/* Fuente */}
                <div className="field" style={{ flex: '0 0 160px', marginBottom: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)' }}>Fuente costo</label>
                  <select value={mpFuente} onChange={e => { setMpFuente(e.target.value); loadMpList(mpSearch, mpTipo, e.target.value) }}
                    style={{ width: '100%', padding: '0.42rem 0.65rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem', background: '#fff' }}>
                    <option value="">Todas</option>
                    <option value="compra">Compra ERP</option>
                    <option value="manual">Manual</option>
                    <option value="sin_precio">Sin precio</option>
                  </select>
                </div>

                <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }}
                  onClick={() => loadMpList(mpSearch, mpTipo, mpFuente)} disabled={mpLoading}>
                  {mpLoading ? 'Cargando…' : '🔍 Buscar'}
                </button>

                {(mpSearch || mpTipo || mpFuente) && (
                  <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}
                    onClick={() => { setMpSearch(''); setMpTipo(''); setMpFuente(''); loadMpList('', '', '') }}>
                    ✕ Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Tabla resultados */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--secondary)' }}>
                  {mpList.length > 0 ? `${mpList.length} registros` : 'Sin resultados'}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Solo lectura — actualice costos en Historial MP/Insumos o Costos Manuales</span>
              </div>

              {mpLoading && <div className="tbl-wrap"><table className="tbl"><SkeletonTable rows={6} cols={5} /></table></div>}

              {!mpLoading && mpList.length === 0 && (
                <div className="empty-state">
                  {mpSearch || mpTipo || mpFuente
                    ? 'Sin resultados para los filtros aplicados.'
                    : 'Sin registros. Verifique que el servidor esté activo y haga clic en Buscar.'}
                </div>
              )}

              {!mpLoading && mpList.length > 0 && (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Nombre</th>
                        <th>Tipo</th>
                        <th>Unidad</th>
                        <th className="num">Costo CLP</th>
                        <th className="num">Costo USD</th>
                        <th>Fuente</th>
                        <th>Última actualización</th>
                        <th className="num">En # recetas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mpList.map((row, i) => {
                        const fuenteBadge: Record<string, string> = {
                          compra: 'badge-green',
                          manual: 'badge-blue',
                          sin_precio: 'badge-red',
                        }
                        const fuenteLabel: Record<string, string> = {
                          compra: 'Compra',
                          manual: 'Manual',
                          sin_precio: 'Sin precio',
                        }
                        const clp = parseFloat(row.costo_unitario_clp) || 0
                        const usd = parseFloat(row.costo_unitario_usd) || 0
                        const sinCosto = clp === 0
                        return (
                          <tr key={i} style={sinCosto ? { background: '#fff5f5' } : undefined}>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-2)' }}>{row.sku}</td>
                            <td style={{ fontWeight: 500 }}>{row.nombre}</td>
                            <td>
                              <span className={`badge ${row.tipo === 'Insumo' ? 'badge-gray' : 'badge-yellow'}`} style={{ fontSize: '0.72rem' }}>
                                {row.tipo}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>{row.unidad_medida || '—'}</td>
                            <td className="num" style={{ fontWeight: 600, color: sinCosto ? '#dc2626' : undefined }}>
                              {sinCosto ? '—' : `$${fmt(clp, 2)}`}
                            </td>
                            <td className="num" style={{ color: '#6b7280', fontSize: '0.82rem' }}>
                              {sinCosto ? '—' : usd.toFixed(4)}
                            </td>
                            <td>
                              <span className={`badge ${fuenteBadge[row.fuente_costo] ?? 'badge-gray'}`} style={{ fontSize: '0.72rem' }}>
                                {fuenteLabel[row.fuente_costo] ?? row.fuente_costo}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>
                              {row.fecha_actualizacion ? new Date(row.fecha_actualizacion).toLocaleDateString('es-CL') : '—'}
                            </td>
                            <td className="num" style={{ color: '#6b7280' }}>
                              {row.aparece_en_n_recetas > 0 ? row.aparece_en_n_recetas : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== SIMULADOR ===== */}
        {view === 'simulador' && (
          <>
            {/* Toolbar */}
            <div className="toolbar">
              <div className="mode-tabs">
                <button className={`mode-tab ${simMode === 'existente' ? 'active' : ''}`} onClick={() => setSimMode('existente')}>⚡ Receta existente</button>
                <button className={`mode-tab ${simMode === 'nueva' ? 'active' : ''}`} onClick={() => setSimMode('nueva')}>✨ Nueva receta</button>
              </div>

              {simMode === 'existente' && (
                <>
                  <div className="sb-input-wrap" style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
                    <input type="text" placeholder="SKU o nombre del producto…" value={simSearch}
                      onChange={e => { searchSimPT(e.target.value); acSim.reset() }}
                      onKeyDown={e => acSim.onKeyDown(e, simSug.length, () => { const pt = simSug[acSim.idx]; if (pt) selectSimPT(pt.sku, pt.nombre) })}
                      style={{ width: '100%', background: 'white', border: '1px solid var(--border-dark)', borderRadius: 'var(--radius-sm)', padding: '0.42rem 0.65rem', fontSize: '0.82rem' }}
                      autoComplete="off" />
                    {simSug.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {simSug.map((pt, i) => (
                          <div key={i} className={`autocomplete-item${i === acSim.idx ? ' active' : ''}`} onClick={() => selectSimPT(pt.sku, pt.nombre)}>
                            <span className="ac-sku">{pt.sku}</span>
                            <span className="ac-name">{pt.nombre}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => loadSimExplosion()}>Buscar</button>
                  <button className="btn btn-ghost btn-sm" disabled={!explosion && !simSearch}
                    onClick={() => { clearExplosion(); setSimResult(null) }}>✕ Limpiar</button>
                </>
              )}
            </div>

            {/* MODO EXISTENTE */}
            {simMode === 'existente' && explosion && !explosion.detail && (
              <div className="card">
                <div className="card-title">🛠️ What-If — {explosion.sku}</div>
                <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                  Modifique cantidad y costo de cada componente. También puede agregar o eliminar insumos para el escenario.
                </p>

                {/* Buscador para agregar componentes */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem', position: 'relative', maxWidth: 480 }}>
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label style={{ fontSize: '0.72rem' }}>MP / Insumo Existente</label>
                    <input type="text" placeholder="Buscar por código o nombre…"
                      value={simAddSearch}
                      onChange={e => { simAddSearchFn(e.target.value); acSimAdd.reset() }}
                      onKeyDown={e => acSimAdd.onKeyDown(e, simAddSug.length, () => { const ins = simAddSug[acSimAdd.idx]; if (ins) simAddInsumo(ins) })}
                      autoComplete="off"
                      style={{ width: '100%' }} />
                    {simAddSug.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {simAddSug.map((ins, i) => (
                          <div key={i} className={`autocomplete-item${i === acSimAdd.idx ? ' active' : ''}`} onClick={() => simAddInsumo(ins)}>
                            <span className="ac-sku">{ins.sku}</span>
                            <span className="ac-name">{ins.nombre} · <b>${fmt(ins.costo_unitario_clp, 2)}</b> · <span style={{color:'var(--info)'}}>{fmtUSD(ins.costo_unitario_usd, 4)}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Botón agregar libre */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSimLibreOpen(o => !o)}
                  >
                    {simLibreOpen ? '✕ Cancelar' : '+ MP / Insumo (Nuevo)'}
                  </button>
                </div>

                {/* Mini-form inline para ítem libre */}
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
                    <div className="field" style={{ flex: '0 0 130px', marginBottom: 0 }}>
                      <label style={{ fontSize: '0.72rem', color: 'var(--info)' }}>Costo Unit. (US$)</label>
                      <input type="number" min={0} step="any"
                        value={simLibreCostoUsd || ''}
                        onChange={e => setSimLibreCostoUsd(parseFloat(e.target.value) || 0)}
                        style={{ width: '100%', textAlign: 'right', borderColor: '#93c5fd' }} />
                    </div>
                    <button className="btn btn-primary btn-sm"
                      onClick={simAddLibre}
                      disabled={!simLibreNombre.trim() || simLibreCantidad <= 0}>
                      ✓ Agregar
                    </button>
                  </div>
                )}

                {/* Filtro BOM */}
                {Object.keys(simInputs).length > 4 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input type="text" placeholder="🔍 Filtrar insumos por SKU o nombre…"
                      value={simBomFilter}
                      onChange={e => setSimBomFilter(e.target.value)}
                      style={{ flex: 1, maxWidth: 340, padding: '0.32rem 0.55rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.82rem' }} />
                    {simBomFilter && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSimBomFilter('')}>✕</button>
                    )}
                  </div>
                )}

                {(() => {
                  const tc = explosion?.tipo_cambio_usd || null
                  const isPackaging = (row: any) => FAMILIAS_PACKAGING_SET.has((row.familia || '').toUpperCase())
                  const bomQ = simBomFilter.trim().toLowerCase()
                  const matchesBom = (sku: string) => {
                    if (!bomQ) return true
                    const row = simInputs[sku]
                    return sku.toLowerCase().includes(bomQ) || (row.nombre || '').toLowerCase().includes(bomQ)
                  }

                  // Agrupar MP por sub-receta
                  const mpGroupMap = new Map<string, { nombre: string; skus: string[] }>()
                  Object.keys(simInputs).forEach(sku_ins => {
                    const row = simInputs[sku_ins]
                    if (!isPackaging(row)) {
                      const key = row.subreceta_sku || '__directo__'
                      const label = row.subreceta_nombre || 'Insumos directos'
                      if (!mpGroupMap.has(key)) mpGroupMap.set(key, { nombre: label, skus: [] })
                      mpGroupMap.get(key)!.skus.push(sku_ins)
                    }
                  })
                  const packagingSkus = Object.keys(simInputs).filter(s => isPackaging(simInputs[s]) && matchesBom(s))

                  // Totales vivos
                  let simMPCLP = 0
                  Object.keys(simInputs).filter(s => !isPackaging(simInputs[s])).forEach(s => { simMPCLP += simInputs[s].cantidad * simInputs[s].costo })
                  simLibreItems.forEach(it => { simMPCLP += it.cantidad * it.costo })
                  let simTotalCLP = 0
                  Object.keys(simInputs).forEach(s => { simTotalCLP += simInputs[s].cantidad * simInputs[s].costo })
                  simLibreItems.forEach(it => { simTotalCLP += it.cantidad * it.costo })

                  const mpInicialCLP = explosion?.costo_mp_clp || 0
                  const mpInicialUSD = tc ? mpInicialCLP / tc : null
                  const mpSimUSD = tc ? simMPCLP / tc : null
                  const varMP = mpInicialCLP > 0 ? (simMPCLP - mpInicialCLP) / mpInicialCLP * 100 : 0

                  const simSecHeader = (label: string, sub = false) => (
                    <tr>
                      <td colSpan={8} style={{
                        background: sub ? '#f0f7e6' : 'var(--bg)', padding: sub ? '3px 16px' : '3px 8px',
                        fontSize: sub ? '0.66rem' : '0.68rem', fontWeight: 700,
                        color: sub ? 'var(--primary-dark)' : 'var(--secondary)',
                        letterSpacing: '0.06em', borderTop: '1px solid var(--border)',
                      }}>{sub ? `↳ ${label}` : label}</td>
                    </tr>
                  )

                  const renderSimRow = (sku_ins: string) => {
                    const row = simInputs[sku_ins]
                    const orig = explosion.detalle_insumos.find((x: any) => x.insumo_final === sku_ins)
                    const nombre = orig?.nombre_insumo || row.nombre || '—'
                    const isNew = row.isNew === true
                    const stCLP = row.cantidad * row.costo
                    const uUnit = orig?.costo_unitario_usd_actual > 0 ? orig.costo_unitario_usd_actual : (tc ? row.costo / tc : null)
                    const stUSD = uUnit !== null ? row.cantidad * uUnit : null
                    return (
                      <tr key={sku_ins} style={isNew ? { background: '#f0f7ff', borderLeft: '3px solid #84BD00' } : {}}>
                        <td>
                          <span className="fw-600 text-xs" style={{ color: 'var(--primary)', cursor: 'copy' }} title="Copiar SKU" onClick={() => copyToClipboard(sku_ins)}>{sku_ins}</span>
                          {isNew && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Nuevo</span>}
                        </td>
                        <td className="text-sm">{nombre}</td>
                        <td className="num">
                          <input type="number" style={{ width: 80, textAlign: 'right' }} value={row.cantidad}
                            onChange={e => setSimInputs({ ...simInputs, [sku_ins]: { ...row, cantidad: parseFloat(e.target.value) || 0 } })} />
                        </td>
                        <td className="num">
                          <input type="number" style={{ width: 90, textAlign: 'right' }} value={row.costo}
                            onChange={e => setSimInputs({ ...simInputs, [sku_ins]: { ...row, costo: parseFloat(e.target.value) || 0 } })} />
                        </td>
                        <td className="num text-muted text-xs">{uUnit !== null ? fmtUSD(uUnit, 4) : '—'}</td>
                        <td className="num fw-600" style={{ color: 'var(--primary)' }}>${fmt(stCLP, 2)}</td>
                        <td className="num text-xs" style={{ color: 'var(--info)' }}>{stUSD !== null ? fmtUSD(stUSD, 2) : '—'}</td>
                        <td className="ctr">
                          <button className="btn btn-danger btn-sm" onClick={() => simRemoveInsumo(sku_ins)}>✕</button>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <>
                      {/* Stat boxes MP — siempre visibles al cargar receta */}
                      {(Object.keys(simInputs).length > 0 || simLibreItems.length > 0) && (
                        <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
                          <div className="stat-box"><span className="stat-label">MP inicial (CLP)</span><span className="stat-value">${fmt(mpInicialCLP)}</span></div>
                          <div className="stat-box warning"><span className="stat-label">MP simulado (CLP)</span><span className="stat-value">${fmt(simMPCLP)}</span></div>
                          {mpInicialUSD !== null && <div className="stat-box"><span className="stat-label">MP inicial (USD)</span><span className="stat-value">{fmtUSD(mpInicialUSD, 2)}</span></div>}
                          {mpSimUSD !== null && <div className="stat-box warning"><span className="stat-label">MP simulado (USD)</span><span className="stat-value">{fmtUSD(mpSimUSD, 2)}</span></div>}
                          <div className={`stat-box ${varMP > 0 ? 'danger' : varMP < 0 ? 'success' : ''}`}>
                            <span className="stat-label">Variación MP</span>
                            <span className="stat-value">{varMP.toFixed(2)}%</span>
                          </div>
                        </div>
                      )}

                      <div className="tbl-wrap" style={{ marginBottom: '0.75rem' }}>
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Código</th><th>Materia Prima / Insumo</th>
                              <th className="num">Cantidad</th>
                              <th className="num">Unit. CLP</th><th className="num">Unit. USD</th>
                              <th className="num">Subtotal CLP</th><th className="num">Subtotal USD</th>
                              <th style={{ width: 36 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* MATERIAS PRIMAS agrupadas por sub-receta */}
                            {Array.from(mpGroupMap.entries()).some(([,{skus}]) => skus.some(matchesBom)) && simSecHeader('MATERIAS PRIMAS')}
                            {Array.from(mpGroupMap.entries()).map(([key, { nombre, skus }]) => {
                              const filteredSkus = skus.filter(matchesBom)
                              if (filteredSkus.length === 0) return null
                              const showSub = mpGroupMap.size > 1 || key !== '__directo__'
                              const subTotal = filteredSkus.reduce((s, sk) => s + simInputs[sk].cantidad * simInputs[sk].costo, 0)
                              const subTotalUSD = tc ? subTotal / tc : null
                              return (
                                <React.Fragment key={key}>
                                  {showSub && simSecHeader(nombre, true)}
                                  {filteredSkus.map(renderSimRow)}
                                  {showSub && (
                                    <tr style={{ background: 'var(--primary-light)' }}>
                                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.73rem', padding: '3px 16px', color: 'var(--secondary)', borderTop: '1px solid var(--border)' }}>
                                        Subtotal {nombre.replace(' (PROCESO)', '').slice(0, 40)}
                                      </td>
                                      <td className="num fw-700" style={{ color: 'var(--primary)', fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>${fmt(subTotal, 2)}</td>
                                      <td className="num fw-700" style={{ color: 'var(--info)', fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>{subTotalUSD !== null ? fmtUSD(subTotalUSD, 2) : '—'}</td>
                                      <td style={{ borderTop: '1px solid var(--border)' }}></td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              )
                            })}

                            {/* INSUMOS / PACKAGING */}
                            {packagingSkus.length > 0 && simSecHeader('INSUMOS / PACKAGING')}
                            {packagingSkus.map(renderSimRow)}
                            {packagingSkus.length > 0 && (() => {
                              const subTotal = packagingSkus.reduce((s, sk) => s + simInputs[sk].cantidad * simInputs[sk].costo, 0)
                              const subTotalUSD = tc ? subTotal / tc : null
                              return (
                                <tr style={{ background: '#fef9ec' }}>
                                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.73rem', padding: '3px 8px', color: 'var(--secondary)', borderTop: '1px solid var(--border)' }}>Subtotal Insumos / Packaging</td>
                                  <td className="num fw-700" style={{ color: 'var(--warning)', fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>${fmt(subTotal, 2)}</td>
                                  <td className="num fw-700" style={{ color: 'var(--info)', fontSize: '0.78rem', borderTop: '1px solid var(--border)' }}>{subTotalUSD !== null ? fmtUSD(subTotalUSD, 2) : '—'}</td>
                                  <td style={{ borderTop: '1px solid var(--border)' }}></td>
                                </tr>
                              )
                            })()}

                            {/* AGREGADOS LIBRES */}
                            {simLibreItems.length > 0 && simSecHeader('AGREGADOS LIBRES')}
                            {simLibreItems.map(it => {
                              const stCLP = it.cantidad * it.costo
                              const stUSD = tc ? stCLP / tc : null
                              return (
                                <tr key={it.id} style={{ background: '#fffbeb', borderLeft: '3px solid var(--warning)' }}>
                                  <td><span className="fw-600 text-xs text-muted">—</span><span className="badge badge-yellow" style={{ marginLeft: 6 }}>Libre</span></td>
                                  <td className="text-sm">{it.nombre}</td>
                                  <td className="num">
                                    <input type="number" style={{ width: 80, textAlign: 'right' }} value={it.cantidad}
                                      onChange={e => setSimLibreItems(prev => prev.map(x => x.id === it.id ? { ...x, cantidad: parseFloat(e.target.value) || 0 } : x))} />
                                  </td>
                                  <td className="num">
                                    <input type="number" style={{ width: 90, textAlign: 'right' }} value={it.costo}
                                      onChange={e => setSimLibreItems(prev => prev.map(x => x.id === it.id ? { ...x, costo: parseFloat(e.target.value) || 0 } : x))} />
                                  </td>
                                  <td className="num text-muted text-xs">{tc ? fmtUSD(it.costo / tc, 4) : '—'}</td>
                                  <td className="num fw-600" style={{ color: 'var(--primary)' }}>${fmt(stCLP, 2)}</td>
                                  <td className="num text-xs" style={{ color: 'var(--info)' }}>{stUSD !== null ? fmtUSD(stUSD, 2) : '—'}</td>
                                  <td className="ctr"><button className="btn btn-danger btn-sm" onClick={() => simRemoveLibre(it.id)}>✕</button></td>
                                </tr>
                              )
                            })}

                            {/* TOTAL */}
                            {(Object.keys(simInputs).length > 0 || simLibreItems.length > 0) && (
                              <tr style={{ background: 'var(--primary-light)', fontWeight: 700 }}>
                                <td colSpan={5} style={{ textAlign: 'right', paddingRight: '0.5rem', fontSize: '0.8rem', borderTop: '2px solid var(--border)' }}>TOTAL RECETA</td>
                                <td className="num" style={{ color: 'var(--primary)', fontSize: '0.875rem', borderTop: '2px solid var(--border)' }}>${fmt(simTotalCLP, 2)}</td>
                                <td className="num" style={{ color: 'var(--info)', fontSize: '0.875rem', borderTop: '2px solid var(--border)' }}>{tc ? fmtUSD(simTotalCLP / tc, 2) : '—'}</td>
                                <td style={{ borderTop: '2px solid var(--border)' }}></td>
                              </tr>
                            )}
                            {Object.keys(simInputs).length === 0 && simLibreItems.length === 0 && (
                              <tr><td colSpan={8}><div className="empty-state">Sin componentes — agregue desde el buscador o use "MP / Insumo (Nuevo)"</div></td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={handleSimular}>⚡ Calcular escenario</button>
                      </div>
                    </>
                  )
                })()}

                {simResult && (() => {
                  const tc = explosion?.tipo_cambio_usd || null
                  // Sin gastos adicionales: usar Costo_Simulado_CLP (suma cruda BOM)
                  const simCLP = simResult.Costo_Simulado_CLP
                  const simUSD = tc ? simCLP / tc : null
                  // Inicial también sin overhead: costo_total_actual_clp = MP + insumos
                  const inicialCLP = explosion?.costo_total_actual_clp || 0
                  const inicialUSD = tc ? inicialCLP / tc : null
                  const varFinal = inicialCLP > 0 ? (simCLP - inicialCLP) / inicialCLP * 100 : 0
                  return (
                    <>
                      <hr className="divider" />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span className="fw-600 text-sm" style={{ color: 'var(--secondary)' }}>Costo total receta (MP + Insumos)</span>
                        <button className="btn btn-primary btn-sm" onClick={() => {
                          const rows = Object.entries(simInputs).map(([sku, v]: [string, any]) => ({
                            'SKU': sku,
                            'Insumo': v.nombre || sku,
                            'Cantidad Simulada': v.cantidad,
                            'Costo Unit. Simulado CLP': v.costo,
                            'Subtotal CLP': (v.cantidad || 0) * (v.costo || 0),
                          }))
                          rows.push({
                            'SKU': '',
                            'Insumo': 'TOTAL SIMULADO',
                            'Cantidad Simulada': 0,
                            'Costo Unit. Simulado CLP': 0,
                            'Subtotal CLP': simCLP,
                          })
                          exportToExcel(
                            [{ name: 'Simulación', data: rows }],
                            `Simulacion_${explosion?.sku || 'SKU'}_${new Date().toISOString().slice(0,10)}.xlsx`
                          )
                        }}>📥 Exportar Excel</button>
                      </div>
                      <div className="stat-row">
                        <div className="stat-box"><span className="stat-label">Total inicial (CLP) <InfoPopover id="se-actual" title="Costo Actual BOM" formula="SUM(cantidad × costo_unitario) — BOM base" description="Costo total de la receta actual según últimos precios de compra o costos manuales, sin overhead." /></span><span className="stat-value">${fmt(inicialCLP)}</span></div>
                        <div className="stat-box primary"><span className="stat-label">Total simulado (CLP) <InfoPopover id="se-sim" title="Costo Simulado" formula="SUM(cantidad_editada × costo_editado) + overhead" description="Costo proyectado con los cambios ingresados. Incluye los mismos gastos adicionales que el costo actual." /></span><span className="stat-value">${fmt(simCLP)}</span></div>
                        {inicialUSD !== null && <div className="stat-box"><span className="stat-label">Total inicial (USD)</span><span className="stat-value">{fmtUSD(inicialUSD, 2)}</span></div>}
                        {simUSD !== null && <div className="stat-box primary"><span className="stat-label">Total simulado (USD)</span><span className="stat-value">{fmtUSD(simUSD, 2)}</span></div>}
                        <div className={`stat-box ${varFinal > 0 ? 'danger' : varFinal < 0 ? 'success' : ''}`}>
                          <span className="stat-label">Diferencial <InfoPopover id="se-dif" title="Variación de Costo" formula="(Simulado − Actual) / Actual × 100" description="Variación porcentual entre el costo actual y el escenario simulado. Rojo = encareció, Verde = abarató." /></span>
                          <span className="stat-value">{varFinal.toFixed(2)}%</span>
                        </div>
                      </div>
                      {/* Comparación lado a lado por insumo */}
                      <div style={{ marginTop: '0.75rem' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setSimCompareOpen(o => !o)}
                        >
                          {simCompareOpen ? '▲ Ocultar detalle comparativo' : '▼ Ver detalle comparativo por insumo'}
                        </button>
                        {simCompareOpen && (() => {
                          // Construir filas: BOM original + simInputs + libres
                          const origMap = new Map<string, any>()
                          ;(explosion?.detalle_insumos || []).forEach((x: any) => origMap.set(x.insumo_final, x))

                          const rows: Array<{
                            sku: string; nombre: string; isNew: boolean; isLibre: boolean;
                            cantOrig: number; cantSim: number;
                            costoOrig: number; costoSim: number;
                            stOrig: number; stSim: number;
                            delta: number; deltaPct: number | null;
                          }> = []

                          // Insumos editados (simInputs)
                          Object.keys(simInputs).forEach(sku => {
                            const sim = simInputs[sku]
                            const orig = origMap.get(sku)
                            const cantOrig = parseFloat(orig?.cantidad_requerida_formato) || 0
                            const costoOrig = parseFloat(orig?.costo_unitario_clp_actual) || 0
                            const cantSim = sim.cantidad
                            const costoSim = sim.costo
                            const stOrig = cantOrig * costoOrig
                            const stSim = cantSim * costoSim
                            const delta = stSim - stOrig
                            rows.push({
                              sku, nombre: sim.nombre || orig?.nombre_insumo || '—',
                              isNew: !!sim.isNew, isLibre: false,
                              cantOrig, cantSim, costoOrig, costoSim,
                              stOrig, stSim, delta,
                              deltaPct: stOrig > 0 ? (delta / stOrig) * 100 : null,
                            })
                          })

                          // Insumos libres agregados
                          simLibreItems.forEach(it => {
                            const stSim = it.cantidad * it.costo
                            rows.push({
                              sku: '—', nombre: it.nombre, isNew: true, isLibre: true,
                              cantOrig: 0, cantSim: it.cantidad,
                              costoOrig: 0, costoSim: it.costo,
                              stOrig: 0, stSim, delta: stSim, deltaPct: null,
                            })
                          })

                          // Insumos eliminados (en original pero no en simInputs)
                          ;(explosion?.detalle_insumos || []).forEach((x: any) => {
                            if (!simInputs[x.insumo_final]) {
                              const cantOrig = parseFloat(x.cantidad_requerida_formato) || 0
                              const costoOrig = parseFloat(x.costo_unitario_clp_actual) || 0
                              const stOrig = cantOrig * costoOrig
                              rows.push({
                                sku: x.insumo_final, nombre: x.nombre_insumo, isNew: false, isLibre: false,
                                cantOrig, cantSim: 0, costoOrig, costoSim: 0,
                                stOrig, stSim: 0, delta: -stOrig,
                                deltaPct: stOrig > 0 ? -100 : null,
                              })
                            }
                          })

                          const totalOrigRows = rows.reduce((s, r) => s + r.stOrig, 0)
                          const totalSimRows = rows.reduce((s, r) => s + r.stSim, 0)
                          const totalDelta = totalSimRows - totalOrigRows

                          return (
                            <div className="tbl-wrap" style={{ marginTop: '0.75rem' }}>
                              <table className="tbl" style={{ fontSize: '0.79rem' }}>
                                <thead>
                                  <tr>
                                    <th>Código</th>
                                    <th>Insumo</th>
                                    <th className="num">Cant. Orig.</th>
                                    <th className="num">Cant. Sim.</th>
                                    <th className="num">CU Orig.</th>
                                    <th className="num">CU Sim.</th>
                                    <th className="num">ST Orig.</th>
                                    <th className="num">ST Sim.</th>
                                    <th className="num">Δ CLP</th>
                                    <th className="num">Δ %</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r, i) => {
                                    const eliminated = r.cantSim === 0 && !r.isNew && !r.isLibre && r.stOrig > 0
                                    const rowBg = r.isLibre ? '#fffbeb' : r.isNew ? '#f0f7ff' : eliminated ? '#fff5f5' : undefined
                                    const borderLeft = r.isLibre ? '3px solid var(--warning)' : r.isNew ? '3px solid #84BD00' : eliminated ? '3px solid var(--danger)' : undefined
                                    return (
                                      <tr key={i} style={{ background: rowBg, borderLeft }}>
                                        <td style={{ fontFamily: 'monospace', color: 'var(--text-2)' }}>{r.sku}</td>
                                        <td>
                                          {r.nombre}
                                          {r.isNew && !r.isLibre && <span className="badge badge-blue" style={{ marginLeft: 4 }}>Nuevo</span>}
                                          {r.isLibre && <span className="badge badge-yellow" style={{ marginLeft: 4 }}>Libre</span>}
                                          {eliminated && <span className="badge badge-red" style={{ marginLeft: 4 }}>Eliminado</span>}
                                        </td>
                                        <td className="num text-muted">{r.cantOrig > 0 ? r.cantOrig.toFixed(4) : '—'}</td>
                                        <td className="num">{r.cantSim > 0 ? r.cantSim.toFixed(4) : '—'}</td>
                                        <td className="num text-muted">{r.costoOrig > 0 ? `$${fmt(r.costoOrig, 2)}` : '—'}</td>
                                        <td className="num">{r.costoSim > 0 ? `$${fmt(r.costoSim, 2)}` : '—'}</td>
                                        <td className="num text-muted">{r.stOrig > 0 ? `$${fmt(r.stOrig, 2)}` : '—'}</td>
                                        <td className="num fw-600">{r.stSim > 0 ? `$${fmt(r.stSim, 2)}` : '—'}</td>
                                        <td className="num fw-600" style={{ color: r.delta > 0 ? 'var(--danger)' : r.delta < 0 ? 'var(--success)' : '#888' }}>
                                          {r.delta !== 0 ? `${r.delta > 0 ? '+' : ''}$${fmt(r.delta, 0)}` : '—'}
                                        </td>
                                        <td className="num" style={{ color: r.deltaPct != null ? (r.deltaPct > 0 ? 'var(--danger)' : r.deltaPct < 0 ? 'var(--success)' : '#888') : '#888' }}>
                                          {r.deltaPct != null ? `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%` : '—'}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                  {/* Fila total */}
                                  <tr style={{ background: 'var(--primary-light)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                                    <td colSpan={6} style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--secondary)' }}>TOTAL</td>
                                    <td className="num" style={{ color: 'var(--text-2)' }}>${fmt(totalOrigRows, 2)}</td>
                                    <td className="num" style={{ color: 'var(--primary)' }}>${fmt(totalSimRows, 2)}</td>
                                    <td className="num" style={{ color: totalDelta > 0 ? 'var(--danger)' : totalDelta < 0 ? 'var(--success)' : '#888' }}>
                                      {totalDelta !== 0 ? `${totalDelta > 0 ? '+' : ''}$${fmt(totalDelta, 0)}` : '—'}
                                    </td>
                                    <td className="num" style={{ color: totalOrigRows > 0 ? (totalDelta > 0 ? 'var(--danger)' : 'var(--success)') : '#888' }}>
                                      {totalOrigRows > 0 ? `${totalDelta > 0 ? '+' : ''}${((totalDelta / totalOrigRows) * 100).toFixed(1)}%` : '—'}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}
                      </div>

                      <button className="btn btn-primary btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => {
                        const inicialCLP = explosion?.costo_total_actual_clp || 0
                        const simCLP = simResult.Costo_Simulado_CLP
                        // Resumen comparativo
                        const resumen = [{
                          'Producto SKU': explosion?.sku || '',
                          'Nombre': explosion?.nombre || '',
                          'Costo Actual CLP': inicialCLP,
                          'Costo Simulado CLP': simCLP,
                          'Variación CLP': simCLP - inicialCLP,
                          'Variación %': inicialCLP > 0 ? +((simCLP - inicialCLP) / inicialCLP * 100).toFixed(2) : 0,
                          'Costo Final Actual CLP': explosion?.costo_final_clp || 0,
                        }]
                        // Detalle insumos original vs simulado
                        const detalle = Object.keys(simInputs).map(sku => {
                          const orig = explosion?.detalle_insumos?.find((x: any) => x.insumo_final === sku)
                          const sim = simInputs[sku]
                          const cantOrig = parseFloat(orig?.cantidad_requerida_formato) || 0
                          const costoOrig = parseFloat(orig?.costo_unitario_clp_actual) || 0
                          return {
                            'SKU Insumo': sku,
                            'Nombre': sim.nombre || orig?.nombre_insumo || '',
                            'Cantidad Original': cantOrig,
                            'Cantidad Simulada': sim.cantidad,
                            'Costo Unit. Original CLP': costoOrig,
                            'Costo Unit. Simulado CLP': sim.costo,
                            'Subtotal Original CLP': +(cantOrig * costoOrig).toFixed(2),
                            'Subtotal Simulado CLP': +(sim.cantidad * sim.costo).toFixed(2),
                            'Variación CLP': +((sim.cantidad * sim.costo) - (cantOrig * costoOrig)).toFixed(2),
                            'Es nuevo': sim.isNew ? 'Sí' : 'No',
                          }
                        })
                        // Hoja Receta Simulada
                        const recetaSim: Record<string, any>[] = Object.keys(simInputs).map(sku => {
                          const row = simInputs[sku]
                          const isNew = !!row.isNew
                          return {
                            'Sección': isNew ? 'NUEVO' : FAMILIAS_PACKAGING_SET.has((row.familia || '').toUpperCase()) ? 'INSUMOS / PACKAGING' : 'MATERIAS PRIMAS',
                            'Código': sku,
                            'Nombre': row.nombre || '—',
                            'Cantidad Simulada': row.cantidad,
                            'CU Simulado CLP': row.costo,
                            'Subtotal Simulado CLP': +(row.cantidad * row.costo).toFixed(2),
                          }
                        })
                        simLibreItems.forEach(it => recetaSim.push({
                          'Sección': 'LIBRE',
                          'Código': '—',
                          'Nombre': it.nombre,
                          'Cantidad Simulada': it.cantidad,
                          'CU Simulado CLP': it.costo,
                          'Subtotal Simulado CLP': +(it.cantidad * it.costo).toFixed(2),
                        }))
                        exportToExcel([
                          { name: 'Resumen', data: resumen },
                          { name: 'Detalle Insumos', data: detalle.length > 0 ? detalle : [{ 'Sin datos': '' }] },
                          { name: 'Receta Simulada', data: recetaSim.length > 0 ? recetaSim : [{ 'Sin datos': '' }] },
                        ], `Simulacion_${explosion?.sku || 'receta'}_${new Date().toISOString().slice(0,10)}.xlsx`)
                      }}>📥 Exportar comparativo Excel</button>
                      {/* Guardar escenario */}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <input type="text" placeholder="Nombre del escenario…" value={escNombre}
                          onChange={e => setEscNombre(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') guardarEscenario() }}
                          style={{ flex: '1 1 200px', padding: '0.38rem 0.6rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.82rem' }} />
                        <button className="btn btn-ghost btn-sm" onClick={guardarEscenario} disabled={escSaving}>
                          💾 {escSaving ? 'Guardando…' : 'Guardar escenario'}
                        </button>
                        {escSaveMsg && <span style={{ fontSize: '0.78rem', color: escSaveMsg.startsWith('✅') ? 'var(--success)' : 'var(--danger)' }}>{escSaveMsg}</span>}
                      </div>
                    </>
                  )
                })()}

                {/* Gastos adicionales — siempre visibles cuando hay explosión */}
                {explosion && !explosion.detail && (() => {
                  const tc = explosion.tipo_cambio_usd || 950
                  const bom = (explosion.costo_mp_clp || 0) + (explosion.costo_insumos_clp || 0)
                  const mermaFactor = explosion.merma_factor || 1
                  const mermaAmt = bom * (mermaFactor - 1)
                  const flete  = explosion.flete_clp || 0
                  const pallet = explosion.pallet_clp || 0
                  const leyRep = explosion.ley_rep_clp || 0
                  const disp   = explosion.disposicion_clp || 0
                  const gtos   = explosion.gtos_indirectos_clp || 0
                  const total  = mermaAmt + flete + pallet + leyRep + disp + gtos
                  const costoFinal = explosion.costo_final_clp || 0
                  const rows: Array<{ label: React.ReactNode; clp: number }> = [
                    ...(mermaAmt > 0 ? [{ label: (<><span>Merma global (×{mermaFactor})</span><InfoPopover id="se-g-merma" title="Merma Global" formula="BOM × (merma_factor − 1)" description="Pérdida de material en producción. Factor configurable en Parámetros Globales." /></>), clp: mermaAmt }] : []),
                    { label: (<><span>Flete base</span><InfoPopover id="se-g-flete" title="Costo de Flete" formula="peso_kg × costo_flete_base_kilo" description="Flete genérico por peso del formato. En rentabilidad por cadena se usa el flete negociado con cada cliente." /></>), clp: flete },
                    { label: (<><span>Pallet base</span><InfoPopover id="se-g-pallet" title="Costo de Pallet" formula="peso_kg × costo_pallet_base_kilo" description="Costo de paletización base por peso del formato." /></>), clp: pallet },
                    { label: (<><span>Ley REP</span><InfoPopover id="se-g-rep" title="Ley REP" formula="ley_rep_clp (SKU) · o · peso_kg × ley_rep_por_kilo" description="Ley de Responsabilidad Extendida del Productor. Si el SKU tiene valor asignado tiene prioridad sobre el valor global por kilo." /></>), clp: leyRep },
                    { label: (<><span>Disposición</span><InfoPopover id="se-g-disp" title="Costo de Disposición" formula="peso_kg × disposicion_por_kilo" description="Costo regulatorio de disposición final del producto, por kilo." /></>), clp: disp },
                    { label: (<><span>Gastos Indirectos</span><InfoPopover id="se-g-ind" title="Gastos Indirectos" formula="costo_con_merma × gastos_indirectos_%" description="Gastos de estructura y operación como porcentaje del costo base (post-merma)." /></>), clp: gtos },
                  ]
                  return (
                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Gastos Adicionales
                      </div>
                      <table className="tbl" style={{ fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th className="num">CLP</th>
                            <th className="num">USD</th>
                            <th className="num">% s/ Costo Final</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              <td>{r.label}</td>
                              <td className="num">${fmt(r.clp, 2)}</td>
                              <td className="num" style={{ color: '#6b7280' }}>{(r.clp / tc).toFixed(2)}</td>
                              <td className="num" style={{ color: '#6b7280' }}>{costoFinal > 0 ? ((r.clp / costoFinal) * 100).toFixed(1) + '%' : '—'}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)', background: '#f8faf4' }}>
                            <td>Total gastos</td>
                            <td className="num">${fmt(total, 2)}</td>
                            <td className="num" style={{ color: '#6b7280' }}>{(total / tc).toFixed(2)}</td>
                            <td className="num" style={{ color: '#6b7280' }}>{costoFinal > 0 ? ((total / costoFinal) * 100).toFixed(1) + '%' : '—'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* MODO NUEVA */}
            {simMode === 'nueva' && (
              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <span>✨ Simulador de nueva receta</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    setNuevaNombre('')
                    setNuevaFormato('')
                    setNuevaConfig({ peso_kilos: 1.0 })
                    setNuevaUnidad('kg')
                    setNuevaDensidad('')
                    setNuevaMermaFactor('')
                    setNuevaInsumos([])
                    setSearchInsumo('')
                  }}>✕ Limpiar</button>
                </div>

                {/* ── Paso 1: Identificación del producto ── */}
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                    Paso 1 — Identificación del producto
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div className="field" style={{ flex: '2 1 280px', marginBottom: 0 }}>
                      <label>Nombre del producto terminado</label>
                      <input type="text" placeholder="Ej: Laca Alto Sólido 1 Gal — nueva fórmula"
                        value={nuevaNombre} onChange={e => setNuevaNombre(e.target.value)}
                        style={{ width: '100%' }} />
                    </div>
                    <div className="field" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                      <label>Formato a producir</label>
                      <select value={nuevaFormato} onChange={e => setNuevaFormato(e.target.value)}
                        style={{ width: '100%', padding: '0.42rem 0.65rem', fontSize: '0.82rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'white' }}>
                        <option value="">— Seleccionar —</option>
                        {formatosList.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Paso 2: Cantidad a producir ── */}
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                    Paso 2 — Cantidad y características físicas
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    {/* Cantidad */}
                    <div className="field" style={{ flex: '0 0 130px', marginBottom: 0 }}>
                      <label>Cantidad a producir</label>
                      <input type="number" min={0} step="any" value={nuevaConfig.peso_kilos}
                        onChange={e => setNuevaConfig({ peso_kilos: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', textAlign: 'right' }} />
                    </div>
                    {/* Unidad */}
                    <div className="field" style={{ flex: '0 0 120px', marginBottom: 0 }}>
                      <label>Unidad</label>
                      <select value={nuevaUnidad} onChange={e => setNuevaUnidad(e.target.value as any)}
                        style={{ width: '100%', padding: '0.42rem 0.65rem', fontSize: '0.82rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'white' }}>
                        <option value="kg">Kilogramo (kg)</option>
                        <option value="litro">Litro (L)</option>
                        <option value="galon">Galón (3,785 L)</option>
                        <option value="unidad">Unidad</option>
                      </select>
                    </div>
                    {/* Densidad — solo cuando es litro o galón */}
                    {(nuevaUnidad === 'litro' || nuevaUnidad === 'galon') && (
                      <div className="field" style={{ flex: '0 0 140px', marginBottom: 0 }}>
                        <label>Densidad (kg/L)</label>
                        <input type="number" min={0} step="any" placeholder="Ej: 1.025"
                          value={nuevaDensidad} onChange={e => setNuevaDensidad(e.target.value)}
                          style={{ width: '100%', textAlign: 'right', borderColor: !nuevaDensidad ? 'var(--warning)' : 'var(--border)' }} />
                        {!nuevaDensidad && <div style={{ fontSize: '0.65rem', color: 'var(--warning)', marginTop: 2 }}>Requerido para calcular kg</div>}
                      </div>
                    )}
                    {/* kg equivalente calculado */}
                    {nuevaUnidad !== 'kg' && nuevaConfig.peso_kilos > 0 && (
                      <div style={{ flex: '0 0 auto', padding: '0.5rem 0.85rem', background: 'var(--primary-light)', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginBottom: 2 }}>Equivalente en kg</div>
                        <div style={{ fontWeight: 700, color: 'var(--primary-dark)' }}>
                          {nuevaKgEquivalente().toFixed(3)} kg
                        </div>
                      </div>
                    )}
                    {/* Merma factor override */}
                    <div className="field" style={{ flex: '0 0 160px', marginBottom: 0 }}>
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        Merma (factor)
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>global: {params?.merma_global_factor ?? 1}</span>
                      </label>
                      <input type="number" min={1} step="any" placeholder={String(params?.merma_global_factor ?? 1)}
                        value={nuevaMermaFactor} onChange={e => setNuevaMermaFactor(e.target.value)}
                        style={{ width: '100%', textAlign: 'right' }} />
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginTop: 2 }}>vacío = usa parámetro global</div>
                    </div>
                  </div>
                </div>

                {/* Paso 3: Insumos — visible cuando hay cantidad */}
                {nuevaConfig.peso_kilos > 0 && (
                  <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                      Paso 3 — Componentes de la receta
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
                        <div className="field">
                          <label>Agregar MP / Insumo Existente</label>
                          <input type="text" placeholder="Ej: Resina, AGUA, Pigmento…" value={searchInsumo}
                            onChange={e => { searchInsumoFn(e.target.value); acInsumos.reset() }}
                            onKeyDown={e => acInsumos.onKeyDown(e, insumosSug.length, () => { const ins = insumosSug[acInsumos.idx]; if (ins) addInsumo(ins) })}
                            autoComplete="off" />
                        </div>
                        {insumosSug.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {insumosSug.map((ins, i) => (
                              <div key={i} className={`autocomplete-item${i === acInsumos.idx ? ' active' : ''}`} onClick={() => addInsumo(ins)}>
                                <span className="ac-sku">{ins.sku}</span>
                                <span className="ac-name">{ins.nombre} · <b>${fmt(ins.costo_unitario_clp, 2)}</b> · <span style={{color:'var(--info)'}}>{fmtUSD(ins.costo_unitario_usd, 4)}</span> / {ins.unidad_medida}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={addInsumoManual}>
                        + Insumo manual
                      </button>
                    </div>

                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Insumo</th>
                        <th className="num">Cantidad</th>
                        <th className="num">Costo Unit. ($)</th>
                        <th className="num">Costo Unit. (US$)</th>
                        <th className="num">Subtotal ($)</th>
                        <th className="num">Subtotal (US$)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {nuevaInsumos.map((row, i) => (
                        <tr key={i}>
                          <td>
                            {row.isManual ? (
                              <input type="text" placeholder="Nombre del insumo…"
                                style={{ width: '100%', minWidth: 160 }}
                                value={row.nombre}
                                onChange={e => updateInsumo(i, 'nombre', e.target.value)} />
                            ) : (
                              <>
                                <span className="fw-600 text-xs" style={{ color: 'var(--primary)' }}>{row.sku}</span>
                                <br />
                                <span className="text-muted text-xs">{row.nombre}</span>
                              </>
                            )}
                            {row.isManual && (
                              <span className="badge badge-blue" style={{ marginTop: 4, display: 'inline-block' }}>Manual</span>
                            )}
                          </td>
                          <td className="num">
                            <input type="number" style={{ width: 90, textAlign: 'right' }} value={row.cantidad_requerida_formato}
                              onChange={e => updateInsumo(i, 'cantidad_requerida_formato', parseFloat(e.target.value) || 0)} />
                          </td>
                          <td className="num">
                            <input type="number" style={{ width: 100, textAlign: 'right' }} value={row.costo_unitario_clp}
                              onChange={e => updateInsumo(i, 'costo_unitario_clp', parseFloat(e.target.value) || 0)} />
                          </td>
                          <td className="num" style={{ color: 'var(--info)' }}>
                            {fmtUSD(row.costo_unitario_usd || 0, 4)}
                          </td>
                          <td className="num fw-600" style={{ color: 'var(--primary)' }}>${fmt(row.costo_teorico_total_clp, 2)}</td>
                          <td className="num fw-600" style={{ color: 'var(--info)' }}>{fmtUSD(row.costo_teorico_total_usd || 0, 2)}</td>
                          <td className="ctr">
                            <button className="btn btn-danger btn-sm"
                              onClick={() => setNuevaInsumos(nuevaInsumos.filter((_, j) => j !== i))}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {!nuevaInsumos.length && (
                        <tr><td colSpan={7}><div className="empty-state">Agregue insumos desde el buscador o con "+ Insumo manual"</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {nuevaInsumos.length > 0 && (() => {
                  const t = calcNueva()
                  return (
                    <>
                      {/* Peso equivalente si no es kg */}
                      {nuevaUnidad !== 'kg' && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', margin: '0.5rem 0 0.25rem' }}>
                          Base de cálculo: <strong>{t.pesoKg.toFixed(3)} kg</strong>
                          {nuevaUnidad === 'litro' && ` (${nuevaConfig.peso_kilos} L × ${nuevaDensidad || '1'} kg/L)`}
                          {nuevaUnidad === 'galon' && ` (${nuevaConfig.peso_kilos} gal × 3.785 × ${nuevaDensidad || '1'} kg/L)`}
                        </div>
                      )}
                      <div className="stat-row" style={{ marginTop: '0.5rem' }}>
                        <div className="stat-box">
                          <span className="stat-label">BOM (MP + Ins.)</span>
                          <span className="stat-value">${fmt(t.insumos)}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--info)' }}>{fmtUSD(nuevaInsumos.reduce((s, r) => s + (r.costo_teorico_total_usd || 0), 0), 2)}</span>
                        </div>
                        {t.mermaAmt > 0 && (
                          <div className="stat-box" style={{ borderLeft: '3px solid var(--warning)' }}>
                            <span className="stat-label">Merma</span>
                            <span className="stat-value">${fmt(t.mermaAmt)}</span>
                          </div>
                        )}
                        <div className="stat-box"><span className="stat-label">Flete est.</span><span className="stat-value">${fmt(t.flete)}</span></div>
                        <div className="stat-box"><span className="stat-label">Pallet est.</span><span className="stat-value">${fmt(t.pallet)}</span></div>
                        <div className="stat-box"><span className="stat-label">Ley REP</span><span className="stat-value">${fmt(t.leyRep)}</span></div>
                        <div className="stat-box"><span className="stat-label">Disposición</span><span className="stat-value">${fmt(t.disp)}</span></div>
                        <div className="stat-box"><span className="stat-label">G. Indirectos</span><span className="stat-value">${fmt(t.ind)}</span></div>
                        <div className="stat-box primary"><span className="stat-label">Costo Final est.</span><span className="stat-value">${fmt(t.total)}</span></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={proyectarNueva}>⚡ Proyectar rentabilidad</button>
                      </div>
                    </>
                  )
                })()}

                {simNuevaResult && (
                  <div style={{ marginTop: '1rem' }}>
                    {/* Desglose de costos */}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                      {[
                        { label: 'Costo MP', val: simNuevaResult.Costo_Base_MP },
                        { label: 'Flete', val: simNuevaResult.Flete_CLP },
                        { label: 'Ley REP', val: simNuevaResult.Ley_Rep_CLP },
                        { label: 'Disposición', val: simNuevaResult.Disposicion_CLP },
                        { label: 'Gtos Indirectos', val: simNuevaResult.Gtos_Indirectos_CLP },
                        { label: 'Costo Final', val: simNuevaResult.Costo_Final_CLP, primary: true },
                      ].map(b => (
                        <div key={b.label} className={`stat-box${b.primary ? ' primary' : ''}`} style={{ flex: '1 1 120px' }}>
                          <span className="stat-label">{b.label}</span>
                          <span className="stat-value">${fmt(b.val)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Tabla de rentabilidad por cadena */}
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--secondary)', marginBottom: '0.5rem' }}>
                      Proyección de rentabilidad por cadena{nuevaNombre ? ` — ${nuevaNombre}` : ''}
                    </div>
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Cadena</th>
                            <th className="num">Flete+Pallet</th>
                            <th className="num">Costo Parcial</th>
                            <th className="num">Precio Lista</th>
                            <th className="num">Precio Final</th>
                            <th className="num">Costo Total</th>
                            <th className="ctr">Mg Lista</th>
                            <th className="ctr">Mg Final</th>
                            <th className="num">Utilidad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(simNuevaResult.rentabilidad_clientes || []).map((rc: any, i: number) => {
                            const mgOk = rc.mg_final_porc >= 10
                            return (
                              <tr key={i}>
                                <td className="fw-600">{rc.cliente}</td>
                                <td className="num text-muted">${fmt(rc.flete_clp + rc.pallet_clp)}</td>
                                <td className="num">${fmt(rc.costo_parcial)}</td>
                                <td className="num">${fmt(rc.precio_lista_envase)}</td>
                                <td className="num fw-600" style={{ color: 'var(--primary-dark)' }}>${fmt(rc.precio_final_envase)}</td>
                                <td className="num text-muted">${fmt(rc.costo_total)}</td>
                                <td className="ctr">
                                  <span className={`badge ${rc.mg_lista_porc >= 10 ? 'badge-blue' : 'badge-yellow'}`}>{rc.mg_lista_porc?.toFixed(1)}%</span>
                                </td>
                                <td className="ctr">
                                  <span className={`badge ${mgOk ? 'badge-green' : 'badge-red'}`}>{rc.mg_final_porc?.toFixed(1)}%</span>
                                </td>
                                <td className="num fw-600" style={{ color: mgOk ? 'var(--success)' : 'var(--danger)' }}>${fmt(rc.utilidad_final)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                  </>
                )}
              </div>
            )}

            {/* MODO PRECIO DESDE COSTO BASE — movido a pestaña Consultas */}
            {false && /* dead code removed */ (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Búsqueda + costo base */}
                <div className="card">
                  <div className="card-title">🎯 Precio desde Costo Base Manual</div>
                  <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: '1rem' }}>
                    Ingresa un costo base personalizado y calcula el precio de venta por cadena usando los parámetros de la BD (editables abajo).
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 260px' }}>
                      <label className="field-label">Producto Terminado</label>
                      <div className="sb-input-wrap" style={{ position: 'relative' }}>
                        <input type="text" className="searchbar" placeholder="Buscar SKU o nombre…"
                          value={baseSearch} onChange={e => { searchBaseSku(e.target.value); acBase.reset() }}
                          onKeyDown={e => acBase.onKeyDown(e, baseSug.length, () => { const s = baseSug[acBase.idx]; if (s) selectBaseSku(s.sku, s.nombre) })} />
                        {baseSug.length > 0 && (
                          <div className="autocomplete-dropdown">
                            {baseSug.map((s: any, i: number) => (
                              <div key={s.sku} className={`autocomplete-item${i === acBase.idx ? ' active' : ''}`}
                                onClick={() => selectBaseSku(s.sku, s.nombre)}>
                                <span className="fw-600">{s.sku}</span> — {s.nombre}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 200px' }}>
                      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        Costo Base (CLP)
                        {baseSku && baseCosto && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--primary-dark)', fontWeight: 600, background: 'var(--primary-light)', borderRadius: 4, padding: '1px 5px' }}>
                            Real: ${fmt(parseFloat(baseCosto) || 0, 0)}
                          </span>
                        )}
                      </label>
                      <input type="number" min="0" placeholder="Ej: 25000"
                        value={baseCosto} onChange={e => setBaseCosto(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.6rem', border: `1.5px solid ${baseSku ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, fontSize: '0.9rem', background: baseSku ? 'var(--primary-light)' : 'white' }} />
                      {baseSku && <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: 2 }}>Precargado · edita para simular otro costo</div>}
                    </div>
                    <button className="btn btn-primary" onClick={calcularPrecioDesdeBase}
                      disabled={!baseSku || !baseCosto || baseLoading}>
                      {baseLoading ? 'Calculando…' : '⚡ Calcular precios'}
                    </button>
                    {(baseSku || baseCosto) && (
                      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}
                        onClick={() => { setBaseSearch(''); setBaseSku(''); setBaseNombre(''); setBaseCosto(''); setBaseSug([]); setBaseResult(null); setBaseParams(null) }}>
                        ✕ Limpiar
                      </button>
                    )}
                  </div>

                  {baseSku && baseResult && (
                    <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem', background: 'var(--primary-light)', borderRadius: 6, fontSize: '0.82rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                      <span><span className="text-muted">SKU: </span><strong>{baseResult.sku}</strong></span>
                      <span><span className="text-muted">Formato: </span>{baseResult.unidad}</span>
                      <span><span className="text-muted">Peso: </span>{baseResult.peso_kg} kg</span>
                      <span><span className="text-muted">BOM actual: </span><strong>${fmt(baseResult.costo_bom_ref)}</strong></span>
                    </div>
                  )}
                </div>

                {/* Parámetros globales editables */}
                {baseParams && (
                  <div className="card">
                    <div className="card-title" style={{ fontSize: '0.9rem' }}>Parámetros de Cálculo</div>
                    <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                      Pre-cargados desde la BD. Modifícalos para simular escenarios distintos sin afectar la configuración global.
                    </p>
                    <div className="form-grid cols-4" style={{ gap: '0.75rem' }}>
                      <div className="field">
                        <label className="field-label">Merma (factor)</label>
                        <input type="number" step="0.01" min="1" value={baseParams!.merma_factor}
                          onChange={e => setBaseParams({ ...baseParams!, merma_factor: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>ej: 1.05 = 5% merma</span>
                      </div>
                      <div className="field">
                        <label className="field-label">Flete base (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.flete_base_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, flete_base_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Pallet base (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.pallet_base_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, pallet_base_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Ley REP (CLP)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.ley_rep_clp}
                          placeholder="Auto"
                          onChange={e => setBaseParams({ ...baseParams!, ley_rep_clp: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>Vacío o 0 = jerarquía automática</span>
                      </div>
                      <div className="field">
                        <label className="field-label">Disposición (CLP/kg)</label>
                        <input type="number" step="0.01" min="0" value={baseParams!.disposicion_kilo}
                          onChange={e => setBaseParams({ ...baseParams!, disposicion_kilo: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      </div>
                      <div className="field">
                        <label className="field-label">Gtos Indirectos (%)</label>
                        <input type="number" step="0.001" min="0" max="1" value={baseParams!.gastos_indirectos}
                          onChange={e => setBaseParams({ ...baseParams!, gastos_indirectos: e.target.value })}
                          style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>ej: 0.05 = 5%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Resultados */}
                {baseResult && (() => {
                  const d = baseResult.desglose_base
                  const cadenas: any[] = baseResult.cadenas || []
                  return (
                    <>
                      {/* Desglose base */}
                      <div className="card">
                        <div className="card-title" style={{ fontSize: '0.9rem' }}>Desglose de Costos Base</div>
                        <div className="stat-row">
                          <div className="stat-box">
                            <span className="stat-label">Costo base ingresado</span>
                            <span className="stat-value">${fmt(d.costo_base)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Merma ({d.merma_factor}×)</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.merma_monto)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">= Con merma</span>
                            <span className="stat-value">${fmt(d.costo_con_merma)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Flete base</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.flete_base)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Ley REP</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.ley_rep)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Disposición</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.disposicion)}</span>
                          </div>
                          <div className="stat-box">
                            <span className="stat-label">+ Gtos Indirectos</span>
                            <span className="stat-value" style={{ color: '#d97706' }}>+${fmt(d.gtos_indirectos)}</span>
                          </div>
                          <div className="stat-box primary">
                            <span className="stat-label">Costo Parcial Base</span>
                            <span className="stat-value">${fmt(d.costo_parcial_base)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Tabla por cadena */}
                      <div className="card" style={{ padding: 0 }}>
                        <div style={{ padding: '0.9rem 1.1rem 0.6rem', borderBottom: '1px solid var(--border)' }}>
                          <div className="card-title" style={{ fontSize: '0.9rem', marginBottom: 0 }}>Precios por Cadena</div>
                          <p className="text-muted text-sm" style={{ margin: '0.2rem 0 0' }}>
                            Haz clic en una fila para ver el desglose completo de esa cadena.
                          </p>
                        </div>
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th>Cadena</th>
                                <th className="num">Flete+Pallet</th>
                                <th className="num">Costo Parcial</th>
                                <th className="num">Factor</th>
                                <th className="num">Precio Lista</th>
                                <th className="num">Desc.</th>
                                <th className="num">Precio Final</th>
                                <th className="num">Costo Total</th>
                                <th className="ctr">Mg Lista</th>
                                <th className="ctr">Mg Final</th>
                                <th className="num">Utilidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cadenas.map((c: any) => {
                                const mgOk = c.mg_final_pct >= 10
                                const expanded = baseExpandRow === c.cliente_id
                                return (
                                  <>
                                    <tr key={c.cliente_id}
                                      onClick={() => setBaseExpandRow(expanded ? null : c.cliente_id)}
                                      style={{ cursor: 'pointer', background: expanded ? 'var(--primary-light)' : undefined }}>
                                      <td><span className="fw-600">{c.cliente}</span></td>
                                      <td className="num text-muted">${fmt(c.flete_cadena + c.pallet_cadena)}</td>
                                      <td className="num">${fmt(c.costo_parcial)}</td>
                                      <td className="num text-muted">{c.factor}×</td>
                                      <td className="num">${fmt(c.precio_lista)}</td>
                                      <td className="num text-muted">{(c.descuento_max * 100).toFixed(1)}%</td>
                                      <td className="num fw-600" style={{ color: 'var(--primary-dark)' }}>${fmt(c.precio_final)}</td>
                                      <td className="num text-muted">${fmt(c.costo_total)}</td>
                                      <td className="ctr">
                                        <span className={`badge ${c.mg_lista_pct >= 10 ? 'badge-blue' : 'badge-yellow'}`}>{c.mg_lista_pct.toFixed(1)}%</span>
                                      </td>
                                      <td className="ctr">
                                        <span className={`badge ${mgOk ? 'badge-green' : 'badge-red'}`}>{c.mg_final_pct.toFixed(1)}%</span>
                                      </td>
                                      <td className="num fw-600" style={{ color: mgOk ? 'var(--success)' : 'var(--danger)' }}>${fmt(c.utilidad)}</td>
                                    </tr>
                                    {expanded && (
                                      <tr key={`${c.cliente_id}-det`} style={{ background: '#f9fdf0' }}>
                                        <td colSpan={11} style={{ padding: '0.75rem 1.25rem' }}>
                                          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Logística cadena</div>
                                              <div>Flete: <strong>${fmt(c.flete_cadena)}</strong></div>
                                              <div>Pallet: <strong>${fmt(c.pallet_cadena)}</strong></div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Precio</div>
                                              <div>Costo parcial: <strong>${fmt(c.costo_parcial)}</strong></div>
                                              <div>× Factor {c.factor} = <strong>${fmt(c.precio_lista)}</strong> lista</div>
                                              <div>− Descuento {(c.descuento_max*100).toFixed(1)}% = <strong>${fmt(c.precio_final)}</strong> final</div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Plan comercial ({c.plan_comercial_pct.toFixed(2)}%)</div>
                                              <div>Comisión ({c.comision_pct.toFixed(1)}%): <strong>${fmt(c.comision_monto)}</strong></div>
                                              <div>Plan: <strong>${fmt(c.plan_comercial_monto)}</strong></div>
                                            </div>
                                            <div>
                                              <div className="text-muted fw-600" style={{ marginBottom: '0.3rem' }}>Resultado</div>
                                              <div>Costo total: <strong>${fmt(c.costo_total)}</strong></div>
                                              <div>Utilidad: <strong style={{ color: c.utilidad > 0 ? 'var(--success)' : 'var(--danger)' }}>${fmt(c.utilidad)}</strong></div>
                                              <div>Margen final: <strong>{c.mg_final_pct.toFixed(2)}%</strong></div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </>
        )}

        {/* ===== ADMIN — Gestión de Usuarios ===== */}
        {view === 'admin' && usuario?.es_admin && (
          <AdminUsuarios currentUserId={usuario.id} onLogout={handleLogout} />
        )}

      </div>

      {/* Global popover — fuera de tablas para evitar herencia CSS */}
      {openPopover && popoverContent && (
        <div onClick={() => setOpenPopover(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
      )}
      {openPopover && popoverContent && (
        <div style={{
          position: 'fixed', zIndex: 9999, width: 280,
          top: popoverPos.top, left: popoverPos.left,
          background: 'white', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
          padding: '0.75rem',
          maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
          fontSize: '0.82rem',
          color: 'var(--secondary)', textAlign: 'left',
          textTransform: 'none', fontWeight: 400, letterSpacing: 'normal',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
            <strong style={{ fontWeight: 700, fontSize: '0.83rem' }}>{popoverContent.title}</strong>
            <button onClick={() => setOpenPopover(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.9rem', padding: 0, marginLeft: 8, flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{
            background: '#f5f7f0', borderRadius: 4, padding: '0.3rem 0.5rem',
            margin: '0.35rem 0', fontSize: '0.76rem', color: '#2d5a00',
            fontFamily: 'monospace', wordBreak: 'break-word'
          }}>{popoverContent.formula}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', lineHeight: 1.45, marginTop: '0.4rem' }}>{popoverContent.description}</div>
        </div>
      )}

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} dismiss={dismissToast} />
      {confirmDlg && <ConfirmDialog opts={confirmDlg} onClose={() => setConfirmDlg(null)} />}
    </div>
  )
}

/* =========================================================
   SUB-COMPONENTE: Administración de Usuarios
========================================================= */
function AdminUsuarios({ currentUserId, onLogout }: { currentUserId: number; onLogout: () => void }) {
  const fmt = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—'

  const [usuarios, setUsuarios]           = useState<any[]>([])
  const [modulos, setModulos]             = useState<{ key: string; label: string }[]>([])
  const [loading, setLoading]             = useState(true)
  const [editando, setEditando]           = useState<any | null>(null)   // usuario en edición
  const [creando, setCreando]             = useState(false)
  const [msg, setMsg]                     = useState('')
  const [msgType, setMsgType]             = useState<'ok' | 'err'>('ok')

  // Form de nuevo usuario
  const [nuevoEmail, setNuevoEmail]       = useState('')
  const [nuevoNombre, setNuevoNombre]     = useState('')
  const [nuevoPass, setNuevoPass]         = useState('')
  const [nuevoAdmin, setNuevoAdmin]       = useState(false)
  const [nuevoPermisos, setNuevoPermisos] = useState<Record<string, boolean>>({})

  // Form de edición
  const [editNombre, setEditNombre]       = useState('')
  const [editEmail, setEditEmail]         = useState('')
  const [editPass, setEditPass]           = useState('')
  const [editAdmin, setEditAdmin]         = useState(false)
  const [editActivo, setEditActivo]       = useState(true)
  const [editPermisos, setEditPermisos]   = useState<Record<string, boolean>>({})

  const showMsg = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4000)
  }

  const authHeader = () => {
    const token = sessionStorage.getItem('passol_token') || ''
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  const load = async () => {
    setLoading(true)
    const [ru, rm] = await Promise.all([
      fetch('/api/admin/usuarios/', { headers: authHeader() }),
      fetch('/api/admin/usuarios/modulos', { headers: authHeader() }),
    ])
    if (ru.status === 401) { onLogout(); return }
    if (ru.ok) setUsuarios(await ru.json())
    if (rm.ok) setModulos(await rm.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const iniciarEdicion = (u: any) => {
    setEditando(u)
    setEditNombre(u.nombre); setEditEmail(u.email)
    setEditPass(''); setEditAdmin(u.es_admin); setEditActivo(u.activo)
    setEditPermisos({ ...u.permisos })
    setCreando(false)
  }

  const guardarEdicion = async () => {
    const body: any = { nombre: editNombre, email: editEmail, es_admin: editAdmin, activo: editActivo, permisos: editPermisos }
    if (editPass) body.password = editPass
    const r = await fetch(`/api/admin/usuarios/${editando.id}`, { method: 'PUT', headers: authHeader(), body: JSON.stringify(body) })
    if (r.ok) { showMsg('Usuario actualizado correctamente.'); setEditando(null); load() }
    else { const d = await r.json(); showMsg(d.detail || 'Error al guardar.', 'err') }
  }

  const crearUsuario = async () => {
    if (!nuevoEmail || !nuevoNombre || !nuevoPass) { showMsg('Completa todos los campos obligatorios.', 'err'); return }
    const r = await fetch('/api/admin/usuarios/', {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ email: nuevoEmail, nombre: nuevoNombre, password: nuevoPass, es_admin: nuevoAdmin, permisos: nuevoPermisos })
    })
    if (r.ok) {
      showMsg('Usuario creado exitosamente.')
      setCreando(false); setNuevoEmail(''); setNuevoNombre(''); setNuevoPass(''); setNuevoAdmin(false); setNuevoPermisos({})
      load()
    } else { const d = await r.json(); showMsg(d.detail || 'Error al crear.', 'err') }
  }

  const eliminar = async (u: any) => {
    if (!confirm(`¿Eliminar permanentemente a ${u.nombre} (${u.email})?`)) return
    const r = await fetch(`/api/admin/usuarios/${u.id}`, { method: 'DELETE', headers: authHeader() })
    if (r.ok) { showMsg('Usuario eliminado.'); load() }
    else { const d = await r.json(); showMsg(d.detail || 'Error.', 'err') }
  }

  const PermisosGrid = ({ permisos, onChange }: { permisos: Record<string, boolean>; onChange: (p: Record<string, boolean>) => void }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem', marginTop: '0.5rem' }}>
      {modulos.map(m => (
        <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', padding: '0.35rem 0.5rem', borderRadius: 6, background: permisos[m.key] ? '#edf7d4' : '#f8f8f8', border: `1px solid ${permisos[m.key] ? '#c3e87a' : '#e5e5e5'}` }}>
          <input type="checkbox" checked={!!permisos[m.key]} onChange={e => onChange({ ...permisos, [m.key]: e.target.checked })} style={{ accentColor: '#84BD00' }} />
          {m.label}
        </label>
      ))}
    </div>
  )

  const selectAll = (_permisos: Record<string, boolean>, setter: (p: Record<string, boolean>) => void, val: boolean) =>
    setter(Object.fromEntries(modulos.map(m => [m.key, val])))

  if (loading) return <div className="empty-state">Cargando usuarios...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 900 }}>
      {msg && <div className={`alert ${msgType === 'ok' ? 'alert-success' : 'alert-error'}`}>{msg}</div>}

      {/* Tabla de usuarios */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Usuarios registrados ({usuarios.length})
          <button className="btn btn-primary btn-sm" onClick={() => { setCreando(true); setEditando(null) }}>+ Nuevo usuario</button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th><th>Email</th><th className="ctr">Rol</th>
                <th className="ctr">Estado</th><th>Último acceso</th><th className="ctr">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.5 }}>
                  <td className="fw-600">{u.nombre} {u.id === currentUserId && <span style={{ fontSize: '0.65rem', color: '#84BD00' }}>(tú)</span>}</td>
                  <td className="text-muted">{u.email}</td>
                  <td className="ctr">
                    {u.es_admin
                      ? <span className="badge badge-green">Admin</span>
                      : <span className="badge badge-gray">Usuario</span>}
                  </td>
                  <td className="ctr">
                    {u.activo
                      ? <span className="badge badge-green">Activo</span>
                      : <span className="badge badge-red">Inactivo</span>}
                  </td>
                  <td className="text-muted text-xs">{fmt(u.last_login)}</td>
                  <td className="ctr" style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => iniciarEdicion(u)}>Editar</button>
                    {u.id !== currentUserId && (
                      <button className="btn btn-danger btn-sm" onClick={() => eliminar(u)}>Eliminar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel crear nuevo usuario */}
      {creando && (
        <div className="card">
          <div className="card-title">Crear nuevo usuario</div>
          <div className="form-grid cols-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div className="field"><label className="field-label">Nombre *</label>
              <input className="field-input" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} placeholder="Nombre completo" /></div>
            <div className="field"><label className="field-label">Email *</label>
              <input className="field-input" type="email" value={nuevoEmail} onChange={e => setNuevoEmail(e.target.value)} placeholder="usuario@empresa.cl" /></div>
            <div className="field"><label className="field-label">Contraseña *</label>
              <input className="field-input" type="password" value={nuevoPass} onChange={e => setNuevoPass(e.target.value)} placeholder="Contraseña inicial" /></div>
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.4rem' }}>
              <input type="checkbox" id="nuevo-admin" checked={nuevoAdmin} onChange={e => setNuevoAdmin(e.target.checked)} style={{ accentColor: '#84BD00' }} />
              <label htmlFor="nuevo-admin" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>¿Es administrador? (acceso total)</label>
            </div>
          </div>
          {!nuevoAdmin && (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#555', marginBottom: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                Módulos accesibles
                <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }} onClick={() => selectAll(nuevoPermisos, setNuevoPermisos, true)}>Todos</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }} onClick={() => selectAll(nuevoPermisos, setNuevoPermisos, false)}>Ninguno</button>
              </div>
              <PermisosGrid permisos={nuevoPermisos} onChange={setNuevoPermisos} />
            </>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreando(false)}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={crearUsuario}>Crear usuario</button>
          </div>
        </div>
      )}

      {/* Panel editar usuario */}
      {editando && (
        <div className="card">
          <div className="card-title">Editar: {editando.nombre}</div>
          <div className="form-grid cols-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div className="field"><label className="field-label">Nombre</label>
              <input className="field-input" value={editNombre} onChange={e => setEditNombre(e.target.value)} /></div>
            <div className="field"><label className="field-label">Email</label>
              <input className="field-input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
            <div className="field"><label className="field-label">Nueva contraseña <span className="text-muted">(vacío = sin cambio)</span></label>
              <input className="field-input" type="password" value={editPass} onChange={e => setEditPass(e.target.value)} placeholder="••••••••" /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingTop: '1.4rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={editAdmin} onChange={e => setEditAdmin(e.target.checked)} style={{ accentColor: '#84BD00' }} disabled={editando.id === currentUserId} />
                Administrador
              </label>
              {editando.id !== currentUserId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editActivo} onChange={e => setEditActivo(e.target.checked)} style={{ accentColor: '#84BD00' }} />
                  Usuario activo
                </label>
              )}
            </div>
          </div>
          {!editAdmin && (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#555', marginBottom: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                Módulos accesibles
                <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }} onClick={() => selectAll(editPermisos, setEditPermisos, true)}>Todos</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }} onClick={() => selectAll(editPermisos, setEditPermisos, false)}>Ninguno</button>
              </div>
              <PermisosGrid permisos={editPermisos} onChange={setEditPermisos} />
            </>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={guardarEdicion}>Guardar cambios</button>
          </div>
        </div>
      )}
    </div>
  )
}

export { ErrorBoundary }
export default App
