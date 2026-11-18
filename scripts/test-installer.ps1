$testDir = Join-Path $env:TEMP "ASP_Test_Install"
if (Test-Path $testDir) { Remove-Item -Recurse -Force $testDir }

$setupExe = (Resolve-Path ".\release-dist\AUDIO_STUDIO_PRO_SETUP.exe").Path
Write-Host "Probando instalador: $setupExe"
$proc = Start-Process -FilePath $setupExe -ArgumentList @("/S", "/D=$testDir") -Wait -PassThru
Write-Host "Install ExitCode: $($proc.ExitCode)"

$installedFiles = Get-ChildItem -Path $testDir -Recurse -File | Select-Object -ExpandProperty Name
Write-Host "Total archivos instalados: $($installedFiles.Count)"
Write-Host "AUDIO STUDIO PRO.exe: $($installedFiles -contains 'AUDIO STUDIO PRO.exe')"
Write-Host "ffmpeg.exe: $($installedFiles -contains 'ffmpeg.exe')"
Write-Host "ffprobe.exe: $($installedFiles -contains 'ffprobe.exe')"
Write-Host "sql-wasm.wasm: $($installedFiles -contains 'sql-wasm.wasm')"

$uninstaller = Join-Path $testDir "Uninstall AUDIO STUDIO PRO.exe"
if (Test-Path $uninstaller) {
  Write-Host "Probando desinstalador: $uninstaller"
  $unProc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  Write-Host "Uninstall ExitCode: $($unProc.ExitCode)"
}

Start-Sleep -Seconds 2
if (Test-Path $testDir) { Remove-Item -Recurse -Force $testDir -ErrorAction SilentlyContinue }
Write-Host "Prueba de instalador NSIS completada con exito."
