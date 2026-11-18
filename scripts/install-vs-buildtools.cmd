@echo off
setlocal
echo ======================================================================
echo  AUDIO STUDIO PRO - Instalador de Visual Studio Build Tools 2022 (C++)
echo ======================================================================
echo.

:: Comprobar si se ejecuta con permisos de administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [i] Solicitando permisos de Administrador a Windows (UAC)...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

set "INSTALLER=%TEMP%\WinGet\Microsoft.VisualStudio.2022.BuildTools.17.14.45\vs_BuildTools.exe"

if not exist "%INSTALLER%" (
    echo [*] Descargando vs_BuildTools.exe oficial de Microsoft...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile '%TEMP%\vs_BuildTools.exe'"
    set "INSTALLER=%TEMP%\vs_BuildTools.exe"
)

echo [*] Ejecutando instalacion de componentes C++:
echo     - Compilador MSVC v143 (x64/x86)
echo     - Windows 10/11 SDK
echo     - Herramientas CMake para C++
echo.
echo Esto abrira el instalador de Visual Studio con la barra de progreso.
echo Espere a que finalice...
echo.

"%INSTALLER%" --passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended

if %errorLevel% equ 0 (
    echo.
    echo ======================================================================
    echo  [OK] Visual Studio Build Tools 2022 instalado correctamente.
    echo ======================================================================
) else (
    echo.
    echo [!] La instalacion finalizo con codigo: %errorLevel%
)

echo.
pause
