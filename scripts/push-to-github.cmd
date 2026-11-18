@echo off
title AUDIO STUDIO PRO - Subir a GitHub
cd /d "%~dp0\.."
echo ======================================================================
echo  Subiendo AUDIO STUDIO PRO al repositorio oficial:
echo  https://github.com/LeonYaM/AudioStudioPro.git
echo ======================================================================
echo.
git remote set-url origin https://github.com/LeonYaM/AudioStudioPro.git
echo Ejecutando: git push -u origin main
echo.
echo (Si aparece una ventana de Git Credential Manager o tu navegador,
echo  inicia sesion o autoriza la conexion a GitHub)
echo.
git push -u origin main
echo.
if %errorlevel% equ 0 (
    echo ======================================================================
    echo  [EXITO] Proyecto subido correctamente a GitHub en la rama main.
    echo ======================================================================
) else (
    echo ======================================================================
    echo  [!] Hubo un error al subir. Revisa los permisos de GitHub.
    echo ======================================================================
)
echo.
pause
