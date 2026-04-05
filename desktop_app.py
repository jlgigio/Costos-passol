"""
desktop_app.py — Lanzador de la aplicación de escritorio PASSOL

Arquitectura:
  1. El frontend (React) ya está compilado en /public/ mediante `build.bat`
  2. FastAPI sirve tanto la API como los archivos estáticos del frontend
  3. pywebview abre una ventana nativa apuntando al servidor local

Para desarrollo activo del frontend usar: npm run dev (puerto 5173)
Para distribución/producción usar: build.bat → luego este archivo
"""

import webview
import threading
import uvicorn
import time
import sys
import os
import logging
import requests

# ── Configurar logging antes de importar la app ──────────────────────────────
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "app.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger("passol.desktop")

# ── Importar la app FastAPI ──────────────────────────────────────────────────
from main import app

PORT = 8001
BASE_URL = f"http://127.0.0.1:{PORT}"
HEALTH_URL = f"{BASE_URL}/api/health"


def get_local_ip() -> str:
    """Obtiene la IP local del PC en la red interna."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def start_backend():
    """Inicia uvicorn escuchando en todas las interfaces (red local + localhost)."""
    local_ip = get_local_ip()
    logger.info(f"Iniciando backend en 0.0.0.0:{PORT}")
    logger.info(f"Acceso red local: http://{local_ip}:{PORT}")
    print(f"\n{'='*50}")
    print(f"  PASSOL Sistema de Costeo — SERVIDOR ACTIVO")
    print(f"{'='*50}")
    print(f"  Local:      http://127.0.0.1:{PORT}")
    print(f"  Red local:  http://{local_ip}:{PORT}  ← compartir con otros PCs")
    print(f"{'='*50}\n")
    uvicorn.run(
        app,
        host="0.0.0.0",              # escucha en todas las interfaces de red
        port=PORT,
        log_level="warning",
        access_log=False,
    )


def wait_for_backend(timeout: int = 30) -> bool:
    """Espera hasta que el backend responda en /api/health."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(HEALTH_URL, timeout=1)
            if r.status_code == 200:
                logger.info("Backend listo.")
                return True
        except Exception:
            pass
        time.sleep(0.4)
    logger.error(f"Backend no respondió en {timeout}s.")
    return False


def check_public_dir() -> bool:
    """Verifica que exista el build del frontend en /public/index.html."""
    index = os.path.join(os.path.dirname(__file__), "public", "index.html")
    if not os.path.exists(index):
        logger.warning("No se encontró public/index.html — ejecuta build.bat primero.")
        return False
    return True


def main():
    logger.info("=== PASSOL Sistema de Costeo — iniciando ===")

    if not check_public_dir():
        webview.create_window(
            title="PASSOL — Error",
            html="""<body style="font-family:sans-serif;padding:2rem;color:#333">
                <h2>⚠️ Frontend no compilado</h2>
                <p>Ejecuta <strong>build.bat</strong> antes de iniciar la aplicación.</p>
                <p style="color:#888;font-size:0.9em">Detalles en: logs/app.log</p>
            </body>""",
            width=480, height=280,
        )
        webview.start()
        return

    # 1. Levantar backend en hilo daemon
    t = threading.Thread(target=start_backend, daemon=True, name="uvicorn")
    t.start()

    # 2. Esperar que el backend esté listo (max 30s)
    if not wait_for_backend(timeout=30):
        webview.create_window(
            title="PASSOL — Error",
            html="""<body style="font-family:sans-serif;padding:2rem;color:#333">
                <h2>❌ No se pudo iniciar el servidor</h2>
                <p>El backend no respondió a tiempo.<br>
                   Verifique que PostgreSQL esté activo y que el puerto 8001 esté libre.</p>
                <p style="color:#888;font-size:0.9em">Detalles en: logs/app.log</p>
            </body>""",
            width=520, height=300,
        )
        webview.start()
        return

    # 3. Abrir ventana nativa
    logger.info("Abriendo ventana de aplicación.")
    webview.create_window(
        title="Sistema de Costeo Industrial — PASSOL Pinturas",
        url=BASE_URL,
        width=1440,
        height=900,
        resizable=True,
        min_size=(1024, 650),
        background_color="#f8faf4",  # --bg del design system
    )
    webview.start()
    logger.info("Ventana cerrada — apagando.")


if __name__ == "__main__":
    main()
