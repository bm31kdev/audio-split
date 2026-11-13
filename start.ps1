# Lance AudioSplit Studio depuis PowerShell après l'installation initiale.
$workspace = $PSScriptRoot
$venvPython = Join-Path $workspace '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Environnement absent. Consultez README.md pour l'installation initiale." -ForegroundColor Yellow
    exit 1
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

function Test-AudioSplitServer([int]$port) {
    try {
        $schema = Invoke-RestMethod -Uri "http://127.0.0.1:$port/openapi.json" -TimeoutSec 2
        return $schema.info.title -eq 'AudioSplit Studio'
    } catch { return $false }
}

$serverPort = $null
foreach ($port in 8000..8010) {
    if (Test-AudioSplitServer $port) {
        Write-Host "AudioSplit Studio est déjà lancé sur http://127.0.0.1:$port" -ForegroundColor Yellow
        Start-Process "http://127.0.0.1:$port"
        exit 0
    }
    if (Test-PortAvailable $port) { $serverPort = $port; break }
}
if ($null -eq $serverPort) {
    Write-Host 'Les ports 8000–8010 sont occupés. Fermez une autre application puis réessayez.' -ForegroundColor Red
    exit 1
}
Write-Host "AudioSplit Studio démarre sur http://127.0.0.1:$serverPort" -ForegroundColor Green

Push-Location $workspace
try { & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port $serverPort --reload }
finally { Pop-Location }
