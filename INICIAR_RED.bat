@echo off
title PASSOL — Servidor de Red
echo ========================================
echo   PASSOL Sistema de Costeo
echo   Modo servidor — red local
echo ========================================
echo.

cd /d "%~dp0"

REM Verificar que existe el frontend compilado
if not exist "public\index.html" (
    echo AVISO: No se encontro el frontend compilado.
    echo Ejecutando build automatico...
    echo.
    call build.bat
    if %ERRORLEVEL% NEQ 0 (
        echo Build fallido. Verifique Node.js y reintentar.
        pause
        exit /b 1
    )
)

echo Iniciando servidor...
echo.
echo Cuando aparezca la IP de red, compartela con los otros usuarios.
echo Ellos deben abrir Chrome y escribir esa direccion.
echo.
echo Para detener el servidor: cerrar esta ventana.
echo.
echo ----------------------------------------

python -c "
import socket, os
from dotenv import load_dotenv
load_dotenv()
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(('8.8.8.8', 80))
    ip = s.getsockname()[0]
    s.close()
except:
    ip = '127.0.0.1'
print(f'  IP del servidor: {ip}')
print(f'  URL para otros usuarios: http://{ip}:8001')
print('----------------------------------------')
print()
"

uvicorn main:app --host 0.0.0.0 --port 8001 --log-level warning

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR al iniciar. Verifique:
    echo   - PostgreSQL esta activo
    echo   - El archivo .env tiene DATABASE_URL configurada
    echo   - El puerto 8001 no esta ocupado
    echo.
    echo Detalles en: logs\app.log
    pause
)
