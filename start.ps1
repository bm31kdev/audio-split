# Lance AudioSplit Studio depuis PowerShell après l'installation initiale.
if (-not (Test-Path ".venv\\Scripts\\python.exe")) {
    Write-Host "Environnement absent. Consultez README.md pour l'installation initiale." -ForegroundColor Yellow
    exit 1
}
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
