# Guía de Distribución, SmartScreen y Actualizaciones — AUDIO STUDIO PRO

## 1. Generar el paquete de distribución
Ejecute desde la raíz del proyecto:
```powershell
.\scripts\prepare-release.ps1
```
Esto genera en `release-dist\`:
- `AUDIO_STUDIO_PRO_SETUP.exe` (instalador Windows x64 con desinstalador y accesos directos)
- `AUDIO_STUDIO_PRO_PORTABLE.exe` (ejecutable portable sin instalación)
- `AUDIO_STUDIO_PRO_SETUP.exe.blockmap` y `latest.yml` (metadatos para actualizaciones diferenciales de `electron-updater`)
- `SHA256SUMS.txt` (hashes SHA-256 verificables para los usuarios)

## 2. Firma Digital (Authenticode) y Windows SmartScreen
Sin firma digital, Windows Defender SmartScreen muestra una advertencia al descargar el `.exe`.
Para distribuir sin advertencias:
1. Obtenga un certificado **Code Signing OV/EV** o configure **Azure Trusted Signing**.
2. Exporte su `.pfx` o use `scripts/prepare-release.ps1`:
```powershell
.\scripts\prepare-release.ps1 -PfxPath "C:\ruta\certificado.pfx" -PfxPassword "TU_PASSWORD"
```
También puede definir `CSC_LINK` y `CSC_KEY_PASSWORD` en su CI/CD (GitHub Actions) para que `electron-builder` firme automáticamente durante el empaquetado.

## 3. Servidor de Descargas y Actualizaciones Automáticas (`electron-updater`)
1. Edite el bloque `"build.publish"` en `package.json` con su URL HTTPS real (por ejemplo un bucket S3/R2 o GitHub Releases).
2. Suba `AUDIO_STUDIO_PRO_SETUP.exe`, `AUDIO_STUDIO_PRO_SETUP.exe.blockmap`, `latest.yml` y `SHA256SUMS.txt` a esa URL.
3. En la aplicación instalada, **Ayuda → Buscar actualizaciones...** consulta `latest.yml` y descarga la nueva versión de forma segura.
