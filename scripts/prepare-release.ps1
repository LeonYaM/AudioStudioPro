<#
.SYNOPSIS
  Compila, empaqueta, firma (opcionalmente) y genera SHA256SUMS.txt para distribución de AUDIO STUDIO PRO.
.EXAMPLE
  .\scripts\prepare-release.ps1
  .\scripts\prepare-release.ps1 -PfxPath "C:\certs\audiostudio.pfx" -PfxPassword "MiPassword"
#>
param(
  [string]$PfxPath = "",
  [string]$PfxPassword = "",
  [string]$OutputDir = "release-dist"
)

$ErrorActionPreference = "Stop"

Write-Host "1. Verificando TypeScript y pruebas..."
npx.cmd tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "Error en tsc --noEmit" }

npx.cmd vitest run
if ($LASTEXITCODE -ne 0) { throw "Error en vitest run" }

Write-Host "2. Compilando Vite y Electron..."
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Error en npm run build" }

Write-Host "3. Empaquetando instalador NSIS, Portable y latest.yml..."
if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir -ErrorAction SilentlyContinue }
npx.cmd electron-builder --win --config.electronDist=node_modules/electron/dist --config.directories.output=$OutputDir
if ($LASTEXITCODE -ne 0) { throw "Error en electron-builder" }

if ($PfxPath -and $PfxPassword) {
  Write-Host "4. Firmando ejecutables con Authenticode..."
  & "$PSScriptRoot\sign-windows.ps1" -PfxPath $PfxPath -PfxPassword $PfxPassword -ReleaseDir $OutputDir
} else {
  Write-Host "4. Firma omitida (no se especificó -PfxPath). Para eliminar advertencias de SmartScreen, firme con un certificado OV/EV."
}

Write-Host "5. Generando SHA256SUMS.txt..."
$artifacts = Get-ChildItem $OutputDir -File | Where-Object {
  $_.Name -in @("AUDIO_STUDIO_PRO_SETUP.exe", "AUDIO_STUDIO_PRO_PORTABLE.exe", "latest.yml")
}
$lines = foreach ($f in $artifacts) {
  $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($f.Name)"
}
$sumPath = Join-Path $OutputDir "SHA256SUMS.txt"
[System.IO.File]::WriteAllLines($sumPath, $lines)
Write-Host "Listo para distribuir en: $OutputDir"
Get-Content $sumPath
