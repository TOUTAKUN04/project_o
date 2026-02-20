$ErrorActionPreference = 'Stop'

Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$exePath = Join-Path $repoRoot 'dist\win-unpacked\Olivia.exe'
$iconPath = Join-Path $repoRoot 'src\main\icon.ico'
$appBuilderPath = Join-Path $repoRoot 'node_modules\app-builder-bin\win\x64\app-builder.exe'
$native7zipPath = Join-Path $repoRoot 'node_modules\7zip-bin\win\x64\7za.exe'

if (-not (Test-Path $appBuilderPath)) {
  throw "app-builder not found at: $appBuilderPath"
}
if (-not (Test-Path $native7zipPath)) {
  throw "7za not found at: $native7zipPath"
}
if (-not (Test-Path $iconPath)) {
  throw "Icon not found at: $iconPath"
}

Write-Host 'Step 1/3: Building win-unpacked (no signing/editing)...'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win dir --config.win.signAndEditExecutable=false

if (-not (Test-Path $exePath)) {
  throw "Expected executable not found after pack step: $exePath"
}

Write-Host 'Step 2/3: Applying custom icon with rcedit...'
# app-builder expects 7za on PATH when it resolves winCodeSign; we provide a shim
# that suppresses non-fatal symlink extraction errors on Windows without symlink privilege.
$shimDir = Join-Path $repoRoot '.tmp-tools'
New-Item -Path $shimDir -ItemType Directory -Force | Out-Null
$shimPath = Join-Path $shimDir '7za.cmd'
@"
@echo off
"$native7zipPath" %*
exit /b 0
"@ | Set-Content -Path $shimPath -Encoding Ascii

$previousPath = $env:PATH
$env:PATH = "$shimDir;$previousPath"
try {
  $argsJson = @(
    'dist\\win-unpacked\\Olivia.exe',
    '--set-icon',
    'src\\main\\icon.ico'
  ) | ConvertTo-Json -Compress
  $argsB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argsJson))

  & $appBuilderPath rcedit --args $argsB64
}
finally {
  $env:PATH = $previousPath
  if (Test-Path $shimDir) {
    Remove-Item -Path $shimDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Step 3/3: Building NSIS installer from prepackaged app...'
npx electron-builder --win nsis --prepackaged dist\win-unpacked --config.win.signAndEditExecutable=false

Write-Host 'Done: dist\Olivia Setup 0.1.0.exe'
