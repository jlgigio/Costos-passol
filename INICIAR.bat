@echo off
title PASSOL — Iniciando aplicacion
echo ========================================
echo   PASSOL Sistema de Costeo
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

echo Iniciando aplicacion de escritorio...
python desktop_app.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR al iniciar. Verifique:
    echo   - PostgreSQL esta activo
    echo   - El archivo .env tiene DATABASE_URL configurada
    echo   - pywebview esta instalado: pip install pywebview requests
    echo.
    echo Detalles en: logs\app.log
    pause
)
