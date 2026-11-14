<#
  AudioSplit Studio v1.3.5 - Windows installation and one-command startup.
  Execution: powershell -ExecutionPolicy Bypass -File .\install-and-run.ps1
#>
[CmdletBinding()]
param([switch]$SkipServer)

$ErrorActionPreference = 'Stop'
$workspace = $PSScriptRoot
$venvPython = Join-Path $workspace '.venv\Scripts\python.exe'
$requirementsPath = Join-Path $workspace 'requirements.txt'
$requirementsLockPath = Join-Path $workspace 'requirements-windows-py311.lock'
$requirementsStamp = Join-Path $workspace '.venv\.audiosplit-requirements.sha256'

function Install-WingetPackage([string]$id) {
    Write-Host "Installation de $id..." -ForegroundColor Cyan
    winget install --id $id --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Winget could not install $id (code $LASTEXITCODE)." }
}

function Find-Python311 {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $launcher) { return $null }
    $found = & $launcher.Source -3.11 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $found) { return $found.Trim() }
    return $null
}

function Get-Python311 {
    $found = Find-Python311
    if (-not $found) {
        Install-WingetPackage 'Python.Python.3.11'
        $found = Find-Python311
    }
    if (-not $found) {
        # Winget may install Python before this PowerShell process sees its new PATH.
        $pythonRoots = @(
            (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
            $env:ProgramFiles,
            ${env:ProgramFiles(x86)}
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
        foreach ($root in $pythonRoots) {
            $installations = Get-ChildItem -LiteralPath $root -Directory -Filter 'Python311*' -ErrorAction SilentlyContinue
            foreach ($installation in $installations) {
                $candidate = Join-Path $installation.FullName 'python.exe'
                if (Test-Path -LiteralPath $candidate) { $found = $candidate; break }
            }
            if ($found) { break }
        }
    }
    if (-not $found) { throw 'Python 3.11 was not found after installation.' }
    return $found
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

$createdVenv = $false
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host 'Creating Python environment...' -ForegroundColor Cyan
    & $python311 -m venv (Join-Path $workspace '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
    $createdVenv = $true
}

$requirementsHash = (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash + (Get-FileHash -LiteralPath $requirementsLockPath -Algorithm SHA256).Hash
$needsDependencyInstall = $createdVenv -or -not (Test-Path -LiteralPath $requirementsStamp)
if (-not $needsDependencyInstall) {
    $installedHash = (Get-Content -LiteralPath $requirementsStamp -Raw).Trim()
    $needsDependencyInstall = $installedHash -ne $requirementsHash
}

function Install-AudioSplitDependencies {
    Write-Host 'Installing / verifying dependencies...' -ForegroundColor Cyan
    & $venvPython -m pip install --require-hashes -r $requirementsLockPath
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    [System.IO.File]::WriteAllText($requirementsStamp, $requirementsHash)
}

if ($needsDependencyInstall) { Install-AudioSplitDependencies }

Write-Host 'Validating installation...' -ForegroundColor Cyan
& $venvPython -c "import demucs, fastapi, multipart, soundfile, torch, torchaudio, torchcodec, uvicorn; print('Python audio : OK')"
$validationExitCode = $LASTEXITCODE
if ($validationExitCode -ne 0 -and -not $needsDependencyInstall) {
    Write-Host 'The existing environment is incomplete; repairing dependencies...' -ForegroundColor Yellow
    Install-AudioSplitDependencies
    & $venvPython -c "import demucs, fastapi, multipart, soundfile, torch, torchaudio, torchcodec, uvicorn; print('Python audio : OK')"
    $validationExitCode = $LASTEXITCODE
}
if ($validationExitCode -ne 0) { throw 'Python dependency validation failed.' }

Write-Host ''
Write-Host 'Installation complete: OK' -ForegroundColor Green
if ($SkipServer) { Write-Host 'Validation mode: server not started.'; exit 0 }

function Test-AudioSplitServer([int]$port) {
    try {
        $schema = Invoke-RestMethod -Uri "http://127.0.0.1:$port/openapi.json" -TimeoutSec 2
        return $schema.info.title -eq 'AudioSplit Studio'
    } catch { return $false }
}

function Test-PortAvailable([int]$port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        $listener.Stop()
    }
}

function Find-AudioSplitEndpoint {
    foreach ($port in 8000..8010) {
        $url = "http://127.0.0.1:$port"
        if (Test-AudioSplitServer $port) { return @{ Port = $port; Url = $url; Reuse = $true } }
        if (Test-PortAvailable $port) { return @{ Port = $port; Url = $url; Reuse = $false } }
    }
    throw 'Ports 8000–8010 are in use. Close another application and run the launcher again.'
}

$endpoint = Find-AudioSplitEndpoint
$serverPort = $endpoint.Port
if ($endpoint.Reuse) {
    Write-Host 'AudioSplit Studio is already running; opening the existing instance.' -ForegroundColor Yellow
    Start-Process $endpoint.Url
    exit 0
}

Write-Host "Opening AudioSplit Studio at $($endpoint.Url)" -ForegroundColor Green
$browserJob = Start-Job -ArgumentList $endpoint.Url -ScriptBlock {
    param($url)
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { Start-Process $url; return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
}
try {
    & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port $serverPort
} finally {
    Stop-Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job $browserJob -Force -ErrorAction SilentlyContinue
}
