# Verzamel alle info die ik nodig heb om te diagnosticeren waarom de
# graphify MCP niet zichtbaar is. Output gaat naar diagnose-output.txt
# zodat je 'm in 1x kan plakken.

$ErrorActionPreference = "Continue"
$OutFile = "D:\Agent Folder\yard-manager\graphify-out\diagnose-output.txt"

function Section($title) {
    Add-Content $OutFile ""
    Add-Content $OutFile "===== $title ====="
}

# Init
"" | Set-Content $OutFile
Section "TIMESTAMP"
Get-Date | Add-Content $OutFile

Section "PYTHON"
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
Add-Content $OutFile "python pad: $py"
if ($py) {
    & $py --version 2>&1 | Add-Content $OutFile
    & $py -c "import graphify, graphify.serve; print('graphify version:', graphify.__version__ if hasattr(graphify,'__version__') else '?')" 2>&1 | Add-Content $OutFile
}

Section "GRAPH.JSON"
$g = "D:\Agent Folder\yard-manager\graphify-out\graph.json"
if (Test-Path $g) {
    $info = Get-Item $g
    Add-Content $OutFile "pad: $g"
    Add-Content $OutFile "size: $($info.Length) bytes"
    Add-Content $OutFile "modified: $($info.LastWriteTime)"
} else {
    Add-Content $OutFile "ONTBREEKT"
}

Section "APPDATA CLAUDE FOLDER"
$dir = "$env:APPDATA\Claude"
Add-Content $OutFile "pad: $dir"
if (Test-Path $dir) {
    Get-ChildItem $dir -Force | Format-Table Name, Length, LastWriteTime -AutoSize | Out-String | Add-Content $OutFile
} else {
    Add-Content $OutFile "ONTBREEKT"
}

Section "claude_desktop_config.json (FULL CONTENT)"
$cfg = "$env:APPDATA\Claude\claude_desktop_config.json"
if (Test-Path $cfg) {
    Add-Content $OutFile "pad: $cfg"
    Get-Content $cfg | Add-Content $OutFile
} else {
    Add-Content $OutFile "ONTBREEKT"
}

Section "mcp.json (als die ergens staat)"
$mcp = "$env:APPDATA\Claude\mcp.json"
if (Test-Path $mcp) {
    Add-Content $OutFile "pad: $mcp"
    Get-Content $mcp | Add-Content $OutFile
} else {
    Add-Content $OutFile "niet gevonden in Claude folder"
}

Section "LOGS in %APPDATA%\Claude\logs"
$logs = "$env:APPDATA\Claude\logs"
if (Test-Path $logs) {
    Get-ChildItem $logs -Force | Format-Table Name, Length, LastWriteTime -AutoSize | Out-String | Add-Content $OutFile
    $mcpLog = Get-ChildItem $logs -Filter "mcp*graphify*" -ErrorAction SilentlyContinue
    if ($mcpLog) {
        Add-Content $OutFile ""
        Add-Content $OutFile "--- Inhoud van $($mcpLog.Name) ---"
        Get-Content $mcpLog.FullName -Tail 60 | Add-Content $OutFile
    }
    Add-Content $OutFile ""
    Add-Content $OutFile "--- Laatste mcp.log (algemeen) ---"
    $genLog = Get-ChildItem $logs -Filter "mcp.log*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($genLog) { Get-Content $genLog.FullName -Tail 60 | Add-Content $OutFile }
} else {
    Add-Content $OutFile "logs folder bestaat niet"
}

Section "GRAPHIFY SERVER STARTUP TEST (5 sec)"
if ($py) {
    $out = & $py -m graphify.serve $g 2>&1 | Select-Object -First 20
    Add-Content $OutFile ($out -join "`n")
}

Section "PROCESS CHECK"
Get-Process | Where-Object { $_.ProcessName -match "Claude|claude|python" } | Format-Table ProcessName, Id, StartTime -AutoSize | Out-String | Add-Content $OutFile

Section "EINDE"

Write-Host ""
Write-Host "Diagnose geschreven naar:" -ForegroundColor Green
Write-Host "  $OutFile"
Write-Host ""
Write-Host "Open 'm en plak de inhoud in chat." -ForegroundColor Yellow
Write-Host ""

# Open het bestand automatisch in Notepad
notepad $OutFile
