@echo off
title PASSOL — Build Frontend
echo ========================================
echo   PASSOL — Compilando frontend...
echo ========================================
echo.

cd /d "%~dp0frontend"

echo [1/2] Instalando dependencias npm si faltan...
call npm install --silent
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install fallido. Verifique que Node.js este instalado.
    pause
    exit /b 1
)

echo [2/2] Compilando React + TypeScript...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build fallido. Revise los errores de TypeScript arriba.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Build exitoso. Frontend en /public/
echo  Puede iniciar la app con INICIAR.bat
echo ========================================
pause
