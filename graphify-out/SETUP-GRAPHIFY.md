# Graphify setup voor yard-manager

De code-graph is al gebouwd en staat in `graphify-out/graph.json` (237 nodes, 369 edges, ~206 KB).
Dit dekt alle .js / .ts bestanden en de `<script>`-blokken van alle .svelte componenten.

Wat jij nog moet doen op Windows zodat Cowork de MCP-tools kan gebruiken:

## 1. Installeer graphifyy

In PowerShell (met Python 3.10+):

```powershell
pip install "graphifyy[mcp]"
graphify install --platform windows
```

(Als je `pipx` of `uv` hebt, gebruik die liever — `pipx install "graphifyy[mcp]"` houdt het schoon.)

Check dat het werkt:

```powershell
graphify --help
python -c "import graphify.serve; print('mcp ok')"
```

## 2. Voeg de MCP-server toe aan Cowork

Cowork's MCP-config staat (afhankelijk van je install) onder een van:
- `%APPDATA%\Claude\mcp.json`
- `%APPDATA%\Cowork\mcp.json`
- of via Cowork → Settings → Connectors → Add custom MCP

Voeg deze entry toe (of merge in bestaande `mcpServers`):

```json
{
  "mcpServers": {
    "graphify": {
      "type": "stdio",
      "command": "python",
      "args": [
        "-m",
        "graphify.serve",
        "D:\\Agent Folder\\yard-manager\\graphify-out\\graph.json"
      ]
    }
  }
}
```

> Let op: dubbele backslashes in JSON-strings.

## 3. Restart Cowork

Sluit Cowork volledig af (system tray → Quit) en start opnieuw. Bij de volgende prompt zou ik de tools `query_graph`, `get_node`, `get_neighbors` en `shortest_path` als beschikbaar moeten zien.

## 4. Graph up-to-date houden

Wanneer je significant code verandert, herbouw de graph met:

```powershell
cd "D:\Agent Folder\yard-manager"
graphify update .
```

Of laat het automatisch gebeuren bij elke commit:

```powershell
cd "D:\Agent Folder\yard-manager"
graphify hook install
```

(Installeert post-commit / post-checkout git hooks die `update` automatisch draaien.)

## Test of het werkt

Vanaf de command line, met de bestaande graph:

```powershell
graphify query "waar wordt brushSizeStore gebruikt?" --graph "D:\Agent Folder\yard-manager\graphify-out\graph.json"
graphify explain "BrushPopover" --graph "D:\Agent Folder\yard-manager\graphify-out\graph.json"
```

Als deze antwoorden geven, werkt de graph zelf. De MCP-koppeling met Cowork is dan een kwestie van de mcp.json + restart.

## Opruimen

Verwijder de map `graphify-out/_svelte_stage` als die er nog staat — dat zijn temp-bestanden van de buildscript die mijn sandbox niet zelf weg kreeg. In Windows Explorer kan je 'm gewoon weggooien.
