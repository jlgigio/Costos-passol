# Estado del Proyecto: Sistema de Costeo Industrial
**Fecha Actualizada:** 17 de Marzo de 2026 (Noche)

## Objetivos Alcanzados (Hoy)
1. **Modelos de Base de Datos para Costos Indirectos y Clientes:**
   - Creación de tabla `parametros_comerciales` para almacenar tarifas base, Ley REP, Merma Global y Gastos Indirectos.
   - Creación de tabla `clientes_condiciones` para alojar los perfiles de rentabilidad, comisiones y "Plan Comercial" (Rapell, Marketing, Rebates) de cada cliente.

2. **API Backend:**
   - Endpoints construidos para realizar un CRUD completo (Crear, Leer, Actualizar, Borrar) tanto de parámetros indirectos como del listado de Clientes.

3. **Frontend: Módulo de Interfaz Completado:**
   - La nueva versión de la interfaz en React (`App.tsx`) ha sido codificada y compilada con éxito tras mudarnos al escritorio local.
   - Formulario interactivo interconectado para administrar **Parámetros Globales**.
   - Tabla y formulario completo para administrar los perfiles de los **Clientes** y sus modificadores.
   - Tabla proyectiva de rentabilidades al final de simulador: *Costo Parcial, P. Lista, P. Final, Utilidad Neta y Margen.*

---

## 🚀 Siguientes Pasos (Para Mañana / Próxima Sesión)

### 1. Ingesta de Datos (Excel):
   - Modificar `excel_processor.py` para que además de las recetas y compras, pueda leer y procesar las nuevas pestañas adicionales requeridas ("codifica", "ley rep", "para consulta") y poblar los parámetros o clientes en la base de datos automáticamente.

### 2. Algoritmo Analítico del Simulador Backend (`costos.py`):
   - Inyectar la matemática desarrollada hoy (cálculo real considerando el Factor Comercial que paga los comisiones y descuentos sobre el Precio Final) y cruzar el costo final (MP + Ley REP + Gtos) contra cada cliente.
   - Asegurar que la respuesta devuelva un bloque `rentabilidad_clientes` correcto para poblar la nueva tabla gráfica del Frontend.

### 3. Pruebas y Simulaciones Reales:
   - Probar con el caso de "Walmart" usando el factor (ej. 5.0) y confirmar que el Margen Final que retorna el sistema a nivel granular coincida matemáticamente con las fórmulas teóricas.

> **Nota para el equipo:** El proyecto se mudó a `C:\Users\gigio\Desktop\PASSOL_COSTEO_DEV` para evitar bloqueos del compilador causados por la sincronización de archivos de Google Drive (`node_modules`).
