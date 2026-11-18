# AUDIO STUDIO PRO

Estación de trabajo de audio (DAW) para Windows: edición de forma de onda, multipista, edición espectral, restauración, herramientas de voz, mezclador y masterización.

**Stack:** Electron, React + TypeScript, Vite, Web Audio API + AudioWorklet, Web Workers, FFmpeg, SQLite (`sql.js`), ONNX Runtime, electron-builder.

## Desarrollo

```powershell
npm.cmd install
npm.cmd run build        # compila renderer y proceso principal
npx.cmd tsc --noEmit     # comprobación de tipos
npx.cmd vitest run       # pruebas
```

## Instalador

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-release.ps1
```

Genera en `release-dist/`: `AUDIO_STUDIO_PRO_SETUP.exe`, `AUDIO_STUDIO_PRO_PORTABLE.exe`, `latest.yml` y `SHA256SUMS.txt`. Los binarios no se versionan; publícalos como GitHub Release.

## Limitaciones conocidas

- El host nativo JUCE (`native-audio-host/`, ASIO y VST3) requiere Visual Studio Build Tools + CMake y compilarse con `scripts/build-native-host.ps1`. Sin él, ASIO y VST3 no están disponibles.
- Los ejecutables no están firmados (SmartScreen mostrará una advertencia).
- La URL de actualizaciones en `package.json` es un marcador de posición.

Ver también `DISTRIBUTION.md` y `PROJECT_STATUS.md`.
