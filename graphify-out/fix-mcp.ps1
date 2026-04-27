# =============================================================
# Graphify -> Claude Desktop MCP fix + diagnose script
#
# Run met: powershell -ExecutionPolicy Bypass -File fix-mcp.ps1
# =============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Graphify MCP diagnose ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check Python en bepaal exact pad
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "[FAIL] 'python' niet gevonden in PATH." -ForegroundColor Red
    Write-Host "       Installeer Python 3.10+ van https://www.python.org/downloads/"
    Read-Host "Druk Enter om af te sluiten"
    exit 1
}
$pythonPath = $pythonCmd.Source
Write-Host "[OK]   python = $pythonPath" -ForegroundColor Green
& $pythonPath --version

# 2. Check graphify package
& $pythonPath -c "import graphify.serve" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] graphify.serve module niet importeerbaar." -ForegroundColor Red
    Write-Host "       Run: pip install graphifyy[mcp]"
    Read-Host "Druk Enter om af te sluiten"
    exit 1
}
Write-Host "[OK]   graphify.serve importeerbaar" -ForegroundColor Green

# 3. Check graph.json
$GraphPath = "D:\Agent Folder\yard-manager\graphify-out\graph.json"
if (-not (Test-Path $GraphPath)) {
    Write-Host "[FAIL] graph.json ontbreekt: $GraphPath" -ForegroundColor Red
    Read-Host "Druk Enter om af te sluiten"
    exit 1
}
$size = (Get-Item $GraphPath).Length
Write-Host "[OK]   graph.json = $GraphPath ($size bytes)" -ForegroundColor Green

# 4. Vind Claude Desktop config
# Claude Desktop op Windows leest %APPDATA%\Claude\claude_desktop_config.json
$ClaudeDir    = "$env:APPDATA\Claude"
$ClaudeConfig = "$ClaudeDir\claude_desktop_config.json"

Write-Host ""
Write-Host "[INFO] Claude Desktop config locatie:" -ForegroundColor Cyan
Write-Host "       $ClaudeConfig"

if (-not (Test-Path $ClaudeDir)) {
    Write-Host "[WARN] $ClaudeDir bestaat niet. Is Claude Desktop wel geinstalleerd?" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null
}

# Lijst alle JSON-files daar voor diagnose
Write-Host ""
Write-Host "[INFO] Alle bestanden in $ClaudeDir :" -ForegroundColor Cyan
Get-ChildItem $ClaudeDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    $name = $_.Name
    $len  = $_.Length
    Write-Host "       - $name ($len bytes)"
}

# 5. Lees of maak config
if (Test-Path $ClaudeConfig) {
    $raw = Get-Content -Raw -Path $ClaudeConfig -Encoding utf8
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = '{}' }
    try {
        $config = $raw | ConvertFrom-Json
    } catch {
        Write-Host "[FAIL] $ClaudeConfig is geen geldige JSON:" -ForegroundColor Red
        Write-Host $_
        Write-Host "       Inhoud:"
        Write-Host $raw
        Read-Host "Druk Enter om af te sluiten"
        exit 1
    }
    Write-Host "[OK]   Bestaande config gelezen" -ForegroundColor Green
} else {
    $config = New-Object PSObject
    Write-Host "[INFO] Geen bestaande config. Maak nieuwe aan." -ForegroundColor Yellow
}

# 6. Backup
if (Test-Path $ClaudeConfig) {
    $stamp = Get-Date -Format yyyyMMdd-HHmmss
    $Backup = "$ClaudeConfig.bak-$stamp"
    Copy-Item $ClaudeConfig $Backup
    Write-Host "[INFO] Backup: $Backup" -ForegroundColor DarkGray
}

# 7. mcpServers toevoegen
if (-not ($config.PSObject.Properties.Name -contains "mcpServers")) {
    $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue (New-Object PSObject)
}
if ($null -eq $config.mcpServers) {
    $config.mcpServers = New-Object PSObject
}

# 8. graphify entry. Gebruik VOLLEDIG python pad voor zekerheid.
$graphifyEntry = [PSCustomObject]@{
    command = $pythonPath
    args    = @("-m", "graphify.serve", $GraphPath)
}

if ($config.mcpServers.PSObject.Properties.Name -contains "graphify") {
    $config.mcpServers.graphify = $graphifyEntry
    Write-Host "[OK]   'graphify' entry geupdate met juiste python pad" -ForegroundColor Green
} else {
    $config.mcpServers | Add-Member -NotePropertyName graphify -NotePropertyValue $graphifyEntry
    Write-Host "[OK]   'graphify' entry toegevoegd" -ForegroundColor Green
}

# 9. Schrijf
$json = $config | ConvertTo-Json -Depth 10
$json | Set-Content -Encoding utf8 $ClaudeConfig

Write-Host ""
Write-Host "[OK]   Geschreven naar: $ClaudeConfig" -ForegroundColor Green
Write-Host ""
Write-Host "==== Eindresultaat ====" -ForegroundColor Cyan
Get-Content $ClaudeConfig
Write-Host ""

# 10. Test of de MCP-server zelf start (3 sec timeout)
Write-Host "==== Test: graphify.serve start ====" -ForegroundColor Cyan
$testJob = Start-Job -ScriptBlock {
    param($py, $g)
    & $py -m graphify.serve $g 2>&1
} -ArgumentList $pythonPath, $GraphPath

Start-Sleep -Seconds 3
if ($testJob.State -eq "Running") {
    Write-Host "[OK]   Server start zonder direct te crashen" -ForegroundColor Green
    Stop-Job $testJob | Out-Null
    Remove-Job $testJob -Force
} else {
    Write-Host "[FAIL] Server crashte direct. Output:" -ForegroundColor Red
    Receive-Job $testJob
    Remove-Job $testJob -Force
}

Write-Host ""
Write-Host "==== Volgende stappen ====" -ForegroundColor Yellow
Write-Host "1. Sluit Claude Desktop COMPLEET af (system tray, rechtermuis, Quit)"
Write-Host "2. Wacht 3 seconden"
Write-Host "3. Start Claude Desktop opnieuw"
Write-Host "4. Open Settings, Developer (of Connectors) en check of 'graphify' in de MCP-lijst staat"
Write-Host "5. Mocht het nog niet werken: kijk in %APPDATA%\Claude\logs\mcp-server-graphify.log"
Write-Host ""
Read-Host "Druk Enter om af te sluiten"
