# Yard Manager — Agent instructies

Deze file is bedoeld voor Claude (Cowork-agent). Gebruiker is **Fugly**, schrijft NL.
Voor architectuur-context: zie `ARCHITECTURE.md`. Voor lopende redesign: `REDESIGN.md`.

## Stack samenvatting (snel)

- Frontend: Svelte 5 + Vite + Konva.js + Dexie (IndexedDB)
- Backend: Node + Express + PostgreSQL (yard_db)
- Sync: diff-push + SSE pull, last-write-wins per entity
- Modes: `view`, `layout`, `inhoud`
- Belangrijke stores: `paintToolStore`, `brushSizeStore`, `modeStore`, `areasStore`, `cellsStore` — allemaal in `frontend/src/lib/stores/`
- Renderer: `frontend/src/lib/canvas/YardRenderer.ts` (Konva, alle paint-logica)
- Edit-tools UI: `frontend/src/lib/components/edit-panel/` (TabIndeling, TabZakken, TabBalen)

## Graphify — code-graph voor snelle navigatie

**Er is een vooraf-gebouwde knowledge graph van de codebase op:**

```
graphify-out/graph.json
```

Met 237 nodes en 369 edges, dekkend voor alle .js/.ts bestanden + de `<script>`-blokken van alle .svelte componenten.

### Bij codebase-vragen — gebruik graphify EERST, dan pas Read

Voor vragen als:
- "waar wordt X gebruikt"
- "wat is de relatie tussen Y en Z"
- "welke functies roept Q aan"
- "hoe hangt component A samen met de renderer"

**Doe dit voordat je bestanden gaat lezen** — graphify geeft 4× minder tokens en directe call-paden.

### Setup in de sandbox (eenmalig per sessie)

Graphify is een Python package. Mijn Linux-sandbox heeft 'm niet by default. Bij eerste gebruik:

```bash
pip install graphifyy --break-system-packages 2>&1 | tail -3
export PATH="$HOME/.local/bin:$PATH"
```

Of als `pip install --break-system-packages` faalt:

```bash
pip install --user graphifyy
export PATH="$HOME/.local/bin:$PATH"
```

### Standaard queries

```bash
GRAPH=/sessions/$(ls /sessions)/mnt/yard-manager/graphify-out/graph.json
# Gebruik bovenstaande variabele in alle calls.

# Wat doet een component / waar haakt het in:
graphify explain "BrushPopover" --graph "$GRAPH"

# Semantische query (BFS over de graph, geeft top relevante nodes):
graphify query "hoe wordt brush size doorgegeven aan de renderer" --graph "$GRAPH" --budget 1500

# Shortest path tussen twee symbolen (toont call-keten):
graphify path "TabIndeling" "YardRenderer" --graph "$GRAPH"
```

### Limitaties

- **Top-level `export const` / store-instances zijn geen nodes.** `brushSizeStore` etc. bestaan niet als zoekbare node — wel `setBrush()`, `BrushPopover`, etc. Voor stores: gewoon grep'en in `frontend/src/lib/stores/`.
- **Svelte template-markup is niet geindexeerd**, alleen het `<script>`-blok. Voor template-vragen ("waar is die knop in de UI"): gewoon grep op de className of label.
- **Graph is statisch** — moet handmatig herbouwd na grote refactors. Build-script: zie `graphify-out/SETUP-GRAPHIFY.md`.

### Wanneer NIET graphify gebruiken

- Specifieke regelnummers nodig → direct `Read` op het bestand
- Tekst-zoeken (variabele namen, comments, error messages) → `Grep`
- Bestand-bestaan / dir-listing → `Glob` of `ls`

## Werkstijl

- Bouwen/runnen gebeurt op user's Windows — `npm run build` en `start.bat`. Niet draaien vanuit sandbox; Linux node_modules bevatten verkeerde native binaries.
- Final outputs worden in `D:\Agent Folder\yard-manager` (workspace folder) gezet zodat ze persistent zijn.
- User schrijft Nederlands; antwoord ook in NL tenzij gevraagd anders.
- Geen emojis in code/files tenzij user vraagt.

## Belangrijke conventies

- Brush-size systeem: `brushSizeStore` (`{ w: 1..20, h: 1..20 }`) → `YardRenderer.brushW/H` via subscribe in `YardCanvas.svelte`. Snap-grid (zak/zak-num) heeft prioriteit boven brush.
- Sync: alle mutations gaan via `lib/sync/engine.ts`. Direct DB writes moeten worden gevolgd door een push.
- Areas vs cells: areas zijn first-class met area_type, cells horen bij een area_id (kan null zijn na delete).
