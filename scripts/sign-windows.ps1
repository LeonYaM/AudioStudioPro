<#
.SYNOPSIS
  Firma digital Authenticode para AUDIO_STUDIO_PRO_SETUP.exe y AUDIO_STUDIO_PRO_PORTABLE.exe
.EXAMPLE
  .\scripts\sign-windows.ps1 -PfxPath "C:\certs\audiostudio.pfx" -PfxPassword "MiPassword"
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$PfxPath,

  [Parameter(Mandatory = $true)]
  [string]$PfxPassword,

  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [string]$ReleaseDir = "release-v3"
)

$ErrorActionPreference = "Stop"

$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) {
  throw "No se encontró signtool.exe. Instale Windows 10/11 SDK."
}

$targets = @(
  (Join-Path $ReleaseDir "AUDIO_STUDIO_PRO_SETUP.exe"),
  (Join-Path $ReleaseDir "AUDIO_STUDIO_PRO_PORTABLE.exe")
)

foreach ($exe in $targets) {
  if (Test-Path $exe) {
    Write-Host "Firmando $exe ..."
    & $signtool sign /fd SHA256 /f $PfxPath /p $PfxPassword /tr $TimestampUrl /td SHA256 $exe
    & $signtool verify /pa $exe
  }
}
