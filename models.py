from pydantic import BaseModel
from typing import List, Dict, Optional, Literal
from datetime import date

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
    moneda_simulacion: Literal["CLP", "USD"] = "CLP"

class SimularNuevaRecetaRequest(BaseModel):
    costo_base_mp: float
    peso_kg: float
    moneda_simulacion: str = "CLP"

class RentabilidadCliente(BaseModel):
    cliente: str
    flete_clp: float
    pallet_clp: float = 0.0
    costo_parcial: float
    comision_monto: float
    plan_comercial_monto: float
    costo_total: float
    precio_lista_envase: float
    precio_final_envase: float
    mg_lista_porc: float
    mg_final_porc: float
    utilidad_final: float

class CostoSimuladoResponse(BaseModel):
    SKU: str = ""
    Costo_Actual_CLP: float
    Costo_Simulado_CLP: float
    Variacion_Costo_Moneda_CLP: float
    Variacion_Costo_Porcentaje: float = 0.0
    Peso_Kilos: float
    Flete_CLP: float
    Ley_Rep_CLP: float
    Disposicion_CLP: float
    Gtos_Indirectos_CLP: float
    Costo_Final_CLP: float
    rentabilidad_clientes: List[RentabilidadCliente] = []

class CostoManualUpsert(BaseModel):
    sku: str
    costo_unitario_clp: float
    notas: Optional[str] = None
    usuario: Optional[str] = None
    precio_cotizacion: Optional[float] = None
    moneda_cotizacion: Optional[str] = 'CLP'
    unidad_cotizacion: Optional[str] = 'Kg'

class CostoManualResponse(BaseModel):
    sku: str
    nombre: str
    unidad_medida: str
    densidad: float = 1.0
    costo_unitario_clp: float
    fecha_actualizacion: date
    notas: Optional[str] = None
    usuario: Optional[str] = None
    tipo_cambio_usd: float = 950.0
    precio_cotizacion: Optional[float] = None
    moneda_cotizacion: Optional[str] = 'CLP'
    unidad_cotizacion: Optional[str] = 'Kg'

class InsumoExplosion(BaseModel):
    insumo_final: str
    nombre_insumo: str
    cantidad_requerida_base: float
    cantidad_requerida_formato: float
    costo_unitario_clp_actual: float
    costo_unitario_usd_actual: float
    costo_teorico_total_clp: float
    costo_teorico_total_usd: float
    fuente_costo: Optional[str] = None
    familia: Optional[str] = None
    subreceta_sku: Optional[str] = None
    subreceta_nombre: Optional[str] = None

class ExplosionResponse(BaseModel):
    sku: str
    costo_total_actual_clp: float
    costo_total_actual_usd: float
    costo_mp_clp: float = 0.0
    costo_insumos_clp: float = 0.0
    # Desglose costos
    peso_kilos: float = 0.0
    litros_formato: float = 0.0
    densidad: float = 0.0
    formato: str = ""
    costo_por_kilo: float = 0.0
    costo_por_litro: float = 0.0
    flete_clp: float = 0.0
    pallet_clp: float = 0.0
    ley_rep_clp: float = 0.0
    disposicion_clp: float = 0.0
    gtos_indirectos_clp: float = 0.0
    merma_factor: float = 1.0
    costo_total_con_merma: float = 0.0
    costo_final_clp: float = 0.0
    tipo_cambio_usd: float = 950.0
    detalle_insumos: List[InsumoExplosion]
    rentabilidad_clientes: List[RentabilidadCliente] = []
    clientes_orig: List[dict] = []
    # Override precio de venta
    pv_activo:       bool  = False
    pv_margen_pct:   float = 0.0
    pv_ajuste_pct:   float = 0.0
    pv_precio_venta: float = 0.0
    pv_precio_final: float = 0.0

class MaestroSKU(BaseModel):
    sku: str
    nombre: str
    tipo: str
    unidad_medida: str

class RecetaBOM(BaseModel):
    sku_padre: str
    sku_hijo: str
    cantidad_neta: float
    porcentaje_merma: float = 0.0

class CostoHistorico(BaseModel):
    sku: str
    costo_unitario: float
    moneda: str = 'CLP'
    proveedor: Optional[str] = None
    fecha_compra: Optional[date] = None
    
class PrecioMargen(BaseModel):
    sku: str
    precio_venta: float
    impuestos: float = 0.0
    canal_venta: Optional[str] = None

class ParametrosComerciales(BaseModel):
    ley_rep_por_kilo: float
    disposicion_por_kilo: float
    gastos_indirectos_porcentaje: float
    comision_porcentaje: float
    merma_global_factor: float
    costo_flete_base_kilo: float
    costo_pallet_base_kilo: float
    tipo_cambio_usd: float = 950.0
    tipo_cambio_eur: float = 0.0
    valor_uf: float = 37000.0

class LeyRepFormato(BaseModel):
    id: Optional[int] = None
    formato: str
    uf_por_formato: float

class ClienteCondicionBase(BaseModel):
    cliente: str
    factor: float = 1.0
    descuento_max: float = 0.0
    comision_promedio: float = 0.0
    rapell: float = 0.0
    fee: float = 0.0
    marketing: float = 0.0
    x_docking: float = 0.0
    rebate: float = 0.0
    rebate_centralizacion: float = 0.0
    flete_por_kilo: float = 0.0        # legacy — mantener para compatibilidad
    flete_agua_kilo: float = 0.0       # flete Pintura Base Agua (PINTURAS AL AGUA, LATEX)
    flete_otros_kilo: float = 0.0      # flete Otros productos
    pallet_agua_kilo: float = 0.0      # pallet Pintura Base Agua
    pallet_otros_kilo: float = 0.0     # pallet Otros productos

class ClienteCondicionCreate(ClienteCondicionBase):
    pass

class ClienteCondicionResponse(ClienteCondicionBase):
    id: int

    class Config:
        from_attributes = True

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
    fuente: str
    proveedor: Optional[str] = None
    insumo_sku: Optional[str] = None
    insumo_nombre: Optional[str] = None
