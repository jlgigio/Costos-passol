import logging
import os
import sys
from datetime import datetime
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from routers import costos, upload
from routers.parametros import router_params, router_clientes, router_ley_rep
from routers.escenarios import router_simulacion, router_escenarios
from routers.productos import router_productos
from routers.auth import router as router_auth
from routers.admin_usuarios import router as router_admin
from database import check_db_connection
from services.auth import decode_token, extract_token, is_public_path

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.FileHandler(
            os.path.join(LOG_DIR, "app.log"), encoding="utf-8"
        ),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("passol.main")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Motor de Costeo Multinivel — PASSOL",
    description="Backend para cálculo de explosión de BOM y simulación What-If",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
    allow_credentials=False,
)

# ── Middleware JWT ────────────────────────────────────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """
    Valida el token JWT en todas las rutas /api/* excepto las públicas.
    Las rutas de archivos estáticos (frontend) no requieren token.
    """
    path = request.url.path

    # Rutas públicas: sin validación
    if is_public_path(path):
        return await call_next(request)

    # Validar token
    token = extract_token(request)
    if not token:
        return JSONResponse(
            status_code=401,
            content={"detail": "No autenticado. Inicia sesión para continuar."}
        )

    try:
        payload = decode_token(token)
        request.state.user = payload
    except Exception:
        return JSONResponse(
            status_code=401,
            content={"detail": "Sesión expirada. Inicia sesión nuevamente."}
        )

    return await call_next(request)

# ── Health endpoint ───────────────────────────────────────────────────────────
_start_time = datetime.now()

@app.get("/api/health", tags=["Sistema"])
def health_check():
    db_ok    = check_db_connection()
    uptime_s = int((datetime.now() - _start_time).total_seconds())
    code     = 200 if db_ok else 503
    return JSONResponse(
        status_code=code,
        content={
            "status":   "ok" if db_ok else "degraded",
            "db":       "ok" if db_ok else "error",
            "uptime_s": uptime_s,
            "version":  "1.0.0",
        },
    )

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(router_auth)          # /api/auth/*  — público (login)
app.include_router(router_admin)         # /api/admin/* — solo admin
app.include_router(costos.router)
app.include_router(upload.router)
app.include_router(router_params)
app.include_router(router_clientes)
app.include_router(router_ley_rep)
app.include_router(router_simulacion)
app.include_router(router_escenarios)
app.include_router(router_productos)

# ── Static files (frontend compilado) ────────────────────────────────────────
_public_dir = os.path.join(os.path.dirname(__file__), "public")
if os.path.isdir(_public_dir):
    app.mount("/", StaticFiles(directory=_public_dir, html=True), name="public")
else:
    logger.warning(
        "Directorio /public/ no encontrado. "
        "Ejecuta build.bat para compilar el frontend."
    )
