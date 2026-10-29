<#
  AudioSplit Studio v1.1.7 - installation et lancement Windows en une commande.
  Execution: powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
#>
[CmdletBinding()]
param([switch]$SkipServer)

$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$venvPython = Join-Path $workspace '.venv\Scripts\python.exe'

function Install-WingetPackage([string]$id) {
    Write-Host "Installation de $id..." -ForegroundColor Cyan
    winget install --id $id --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Winget could not install $id (code $LASTEXITCODE)." }
}

function Get-Python311 {
    $found = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $found) {
        Install-WingetPackage 'Python.Python.3.11'
        $found = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    }
    if ($LASTEXITCODE -ne 0 -or -not $found) { throw 'Python 3.11 was not found after installation.' }
    return $found.Trim()
}

function Enable-FFmpeg {
    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $command) { Install-WingetPackage 'Gyan.FFmpeg.Shared' }
    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $command) {
        $packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        $exe = Get-ChildItem -LiteralPath $packageRoot -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe) { $env:Path += ";$($exe.DirectoryName)" }
    }
    $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $command) { throw "FFmpeg is installed but cannot be found. Reopen PowerShell and run this script again." }
    & ffmpeg -version *> $null
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg did not start correctly.' }
}

Write-Host ''
Write-Host 'AudioSplit Studio - automatic setup' -ForegroundColor Green
$python311 = Get-Python311
Enable-FFmpeg

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host 'Creating Python environment...' -ForegroundColor Cyan
    & $python311 -m venv (Join-Path $workspace '.venv')
}

Write-Host 'Installing / verifying dependencies...' -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $workspace 'requirements.txt')

Write-Host 'Validating installation...' -ForegroundColor Cyan
& $venvPython -c "import demucs, fastapi, soundfile, torch, torchaudio; print('Python audio : OK')"
if ($LASTEXITCODE -ne 0) { throw 'Python dependency validation failed.' }

Write-Host ''
Write-Host 'Installation complete: OK' -ForegroundColor Green
if ($SkipServer) { Write-Host 'Validation mode: server not started.'; exit 0 }

Write-Host 'Opening AudioSplit Studio at http://127.0.0.1:8000' -ForegroundColor Green
Start-Process 'http://127.0.0.1:8000'
& $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000
