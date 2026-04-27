# =============================================================
# Graphify -> Cowork MCP-config installer
#
# Voegt de "graphify" stdio MCP-server toe aan Cowork's mcp.json.
# Idempotent: re-runnen is veilig, het script overwrite niets dat
# je al handmatig hebt aangepast voor andere MCP-servers.
#
# Run: rechtermuisklik op dit bestand -> "Run with PowerShell"
# Of:  powershell -ExecutionPolicy Bypass -File install-mcp.ps1
# =============================================================

$ErrorActionPreference = "Stop"

$GraphPath = "D:\Agent Folder\yard-manager\graphify-out\graph.json"

if (-not (Test-Path $GraphPath)) {
    Write-Host "[ERROR] graph.json niet gevonden op $GraphPath" -ForegroundColor Red
    Write-Host "Bouw eerst de graph (zie SETUP-GRAPHIFY.md)."
    Read-Host "Druk Enter om te sluiten"
    exit 1
}

# Mogelijke locaties voor Cowork/Claude desktop's mcp.json (in volgorde van waarschijnlijkheid)
$Candidates = @(
    "$env:APPDATA\Claude\mcp.json",
    "$env:APPDATA\Cowork\mcp.json",
    "$env:APPDATA\Claude\claude_desktop_config.json",
    "$env:APPDATA\Cowork\claude_desktop_config.json",
    "$env:USERPROFILE\.claude\mcp.json",
    "$env:USERPROFILE\.config\claude\mcp.json"
)

$Target = $null
foreach ($c in $Candidates) {
    if (Test-Path $c) {
        $Target = $c
        break
    }
}

if (-not $Target) {
    Write-Host "[INFO] Geen bestaande mcp.json gevonden in standaard locaties:" -ForegroundColor Yellow
    foreach ($c in $Candidates) { Write-Host "  - $c" }
    Write-Host ""
    $custom = Read-Host "Plak het volledige pad naar Cowork's mcp.json (of laat leeg om Claude default te gebruiken)"
    if ([string]::IsNullOrWhiteSpace($custom)) {
        $Target = "$env:APPDATA\Claude\mcp.json"
        $dir = Split-Path $Target
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        '{"mcpServers":{}}' | Set-Content -Encoding utf8 $Target
        Write-Host "[INFO] Lege mcp.json aangemaakt op $Target" -ForegroundColor Cyan
    } else {
        $Target = $custom
        if (-not (Test-Path $Target)) {
            $dir = Split-Path $Target
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            '{"mcpServers":{}}' | Set-Content -Encoding utf8 $Target
            Write-Host "[INFO] Lege mcp.json aangemaakt op $Target" -ForegroundColor Cyan
        }
    }
}

Write-Host "[INFO] Bewerk: $Target" -ForegroundColor Cyan

# Lees bestaande config
try {
    $raw = Get-Content -Raw -Path $Target -Encoding utf8
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = '{"mcpServers":{}}' }
    $config = $raw | ConvertFrom-Json
} catch {
    Write-Host "[ERROR] Kon mcp.json niet parsen als JSON: $_" -ForegroundColor Red
    Read-Host "Druk Enter om te sluiten"
    exit 1
}

# Backup
$Backup = "$Target.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $Target $Backup
Write-Host "[INFO] Backup: $Backup" -ForegroundColor DarkGray

# Zorg dat mcpServers bestaat
if (-not $config.PSObject.Properties.Name.Contains("mcpServers")) {
    $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue (New-Object PSObject)
}
if ($null -eq $config.mcpServers) {
    $config.mcpServers = New-Object PSObject
}

# Bouw graphify entry
$graphifyEntry = [PSCustomObject]@{
    type    = "stdio"
    command = "python"
    args    = @("-m", "graphify.serve", $GraphPath)
}

# Toevoegen of overschrijven
if ($config.mcpServers.PSObject.Properties.Name -contains "graphify") {
    Write-Host "[INFO] 'graphify' entry bestaat al, wordt geupdate." -ForegroundColor Yellow
    $config.mcpServers.graphify = $graphifyEntry
} else {
    $config.mcpServers | Add-Member -NotePropertyName graphify -NotePropertyValue $graphifyEntry
    Write-Host "[OK] 'graphify' entry toegevoegd." -ForegroundColor Green
}

# Schrijf terug
$config | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $Target

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Klaar! mcp.json is bijgewerkt." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Eindpunt:  $Target"
Write-Host "Graph:     $GraphPath"
Write-Host ""
Write-Host "VOLGENDE STAP (handmatig):" -ForegroundColor Yellow
Write-Host "  1. Sluit Cowork helemaal af:"
Write-Host "     - klik op het Cowork-icoon in je system tray (rechtsonder)"
Write-Host "     - kies 'Quit' / 'Afsluiten' (NIET het kruisje rechtsboven, dat minimaliseert)"
Write-Host "  2. Start Cowork opnieuw"
Write-Host "  3. In een nieuwe sessie zou Claude de graphify tools moeten zien"
Write-Host ""
Read-Host "Druk Enter om te sluiten"
