<#
.SYNOPSIS
  Configura y compila el host nativo JUCE C++ (audio-studio-native-host.exe) para soporte de VST3 y ASIO out-of-process.
#>
param(
  [string]$AsioSdkDir = ""
)

$ErrorActionPreference = "Stop"

# 1. Resolver ruta de CMake
$cmakePath = "cmake"
$cmakeWinget = "C:\Users\Soids\AppData\Local\Microsoft\WinGet\Packages\Kitware.CMake_Microsoft.Winget.Source_8wekyb3d8bbwe\cmake-4.4.4-windows-x86_64\bin\cmake.exe"
if (Test-Path $cmakeWinget) {
  $cmakePath = $cmakeWinget
  $env:PATH = (Split-Path $cmakeWinget) + ";" + $env:PATH
}

Write-Host "1. Verificando CMake..."
& $cmakePath --version
if ($LASTEXITCODE -ne 0) { throw "CMake no encontrado en el sistema." }

# 2. Localizar Visual Studio o compilador MSVC
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsFound = $false
if (Test-Path $vswhere) {
  $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($vsPath) {
    Write-Host "Compilador Visual Studio C++ detectado en: $vsPath"
    $vsFound = $true
  }
}

if (-not $vsFound) {
  Write-Warning "No se encontro Visual Studio C++ instalado todavia."
  Write-Warning "Ejecute scripts\install-vs-buildtools.cmd como Administrador para instalar las herramientas C++."
  return
}

# 3. Configurar CMake
$sourceDir = Join-Path $PSScriptRoot "..\native-audio-host"
$buildDir = Join-Path $sourceDir "build"

Write-Host "2. Configurando proyecto CMake en: $buildDir"
$cmakeArgs = @("-B", $buildDir, "-S", $sourceDir)
if ($AsioSdkDir -and (Test-Path $AsioSdkDir)) {
  $cmakeArgs += "-DASIO_SDK_DIR=$AsioSdkDir"
}

& $cmakePath @cmakeArgs
if ($LASTEXITCODE -ne 0) { throw "Error al configurar CMake para native-audio-host." }

# 4. Compilar en Release
Write-Host "3. Compilando audio-studio-native-host en modo Release..."
& $cmakePath --build $buildDir --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw "Error al compilar audio-studio-native-host." }

# 5. Localizar binario generado
$exeArtifact = Join-Path $buildDir "audio-studio-native-host_artefacts\Release\audio-studio-native-host.exe"
if (-not (Test-Path $exeArtifact)) {
  $candidates = Get-ChildItem -Path $buildDir -Filter "audio-studio-native-host.exe" -Recurse -File
  if ($candidates.Count -gt 0) {
    $exeArtifact = $candidates[0].FullName
  }
}

if (Test-Path $exeArtifact) {
  Write-Host "============================================================"
  Write-Host "[OK] Host nativo JUCE compilado exitosamente en:"
  Write-Host "     $exeArtifact"
  Write-Host "============================================================"
} else {
  Write-Warning "La compilacion finalizo pero no se encontro audio-studio-native-host.exe"
}
