# Yard Manager v2 — Architectuur

## Doel
Snelle, offline-first yard management tool voor 1 yard, 3 tablets + desktop.
Draait op intranet (geen externe toegang nodig).

## Stack

| Laag | Keuze | Waarom |
|------|-------|--------|
| Frontend framework | Svelte 5 + Vite | Tiny runtime, reactief, perfect voor PWA |
| Rendering | Konva.js (canvas) | 60 fps pan/zoom met 10k+ cellen, ingebouwde hit-testing |
| Lokale opslag | IndexedDB via Dexie | Async, ongelimiteerd, transacties |
| Sync | Diff push + SSE pull | Realtime tussen tablets, conflict-safe (last-write-wins per entity) |
| Backend | Node + Express + PostgreSQL | Behouden — werkt prima |
| Auth | Bestaand (dagstart_db users) | Behouden |
| Materials | Read-only uit dagstart_db | Behouden |

## Modes
1. **View** (default) — bekijken, area aantikken voor inspectie / inhoud wijzigen
2. **Layout edit** (admin) — paint cellen, definieer areas, walls
3. **Inhoud bewerken** (admin/supervisor) — wijs materialen toe aan areas

## Data model (PostgreSQL — yard_db)

### `areas`
First-class entity voor "vlakken". Cellen kunnen samen 1 area vormen, of weer gesplitst worden.

```sql
CREATE TABLE areas (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL DEFAULT '',
  area_type     VARCHAR(40) NOT NULL,  -- 'wall', 'container', 'afval', 'bunker', 'zak', 'custom'
  color         VARCHAR(20),           -- override default kleur
  material_name VARCHAR(120),          -- materiaal in deze area (uit dagstart_db.materials.name)
  material_id   INTEGER,               -- FK naar dagstart_db.materials (geen DB-level FK ivm cross-DB)
  metadata      JSONB DEFAULT '{}',    -- vrije ruimte (capaciteit, opmerking, etc.)
  updated_at    BIGINT NOT NULL,
  deleted_at    BIGINT                 -- soft delete voor sync
);
CREATE INDEX idx_areas_updated ON areas(updated_at);
```

### `cells`
Welke cellen horen bij welke area + cel-specifieke meta (bv. zak laag-nr).

```sql
CREATE TABLE cells (
  col         INTEGER NOT NULL,
  row         INTEGER NOT NULL,
  area_id     INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  cell_type   VARCHAR(30) NOT NULL,    -- denormalized van area voor snelle render
  label       VARCHAR(80) DEFAULT '',  -- per-cel override (bv. zak nummer)
  meta        JSONB DEFAULT '{}',      -- cel-specifieke meta
  updated_at  BIGINT NOT NULL,
  deleted_at  BIGINT,
  PRIMARY KEY (col, row)
);
CREATE INDEX idx_cells_area ON cells(area_id);
CREATE INDEX idx_cells_updated ON cells(updated_at);
```

### Behouden (legacy):
- `yard_cells` — voor backward compat, niet meer actief gebruikt
- `yard_layout` — idem
- `balen_items` — wordt vervangen door areas met area_type='bunker'

## API endpoints

| Methode | Pad | Doel |
|---------|-----|------|
| GET | `/api/materials` | Lijst materialen (uit dagstart_db, niet-test, actief) |
| GET | `/api/state` | Volledige snapshot: areas + cells |
| GET | `/api/state/since?ts=N` | Diff sinds timestamp N |
| POST | `/api/sync/v2` | Push diffs (areas + cells) — last-write-wins per entity |
| GET | `/api/events` | SSE stream — server pushed wijzigingen naar verbonden clients |
| POST | `/api/auth/login` | Login (admin/supervisor) — onveranderd |

## Sync model

1. Client schrijft direct naar IndexedDB (instant UI)
2. Mark wijzigingen als `pending` in IndexedDB
3. Achtergrond-sync (elke 5s + bij online event): POST `/api/sync/v2` met pending diffs
4. Server doet last-write-wins per entity op `updated_at`
5. Server broadcast successful changes via SSE
6. Andere clients ontvangen SSE event → pull diff via `/api/state/since`
7. Bij reconnect: client doet `/api/state/since?ts=lastSeen` om alles bij te werken

## Frontend structuur

```
frontend/
  src/
    main.ts                     # entry point
    App.svelte                  # root
    app.css                     # global styles
    lib/
      stores/
        auth.ts                 # logged-in user
        mode.ts                 # 'view' | 'layout' | 'content'
        areas.ts                # reactieve area collectie
        cells.ts                # reactieve cell collectie
        sync.ts                 # online/offline + pending count
        materials.ts            # materiaal lijst uit dagstart
        viewport.ts             # zoom/pan state
      db/
        dexie.ts                # IndexedDB schema (areas, cells, pending)
      sync/
        engine.ts               # push/pull/SSE coordination
      canvas/
        YardRenderer.ts         # Konva stage manager
        AreaShape.ts            # Konva group voor 1 area
        gridUtils.ts            # cell↔pixel conversie, hit testing
      tools/
        paintTool.ts            # edit-mode paint logica
        selectTool.ts           # cell selection
      components/
        Header.svelte
        YardCanvas.svelte
        EditPanel.svelte
        AreaInspector.svelte
        MaterialPicker.svelte
        LoginModal.svelte
        SyncIndicator.svelte
        Toast.svelte
```

## Konva renderer architectuur

**3 layers (van onder naar boven):**

1. `gridLayer` — gestreepte achtergrond, kolom/rij nummers (alleen in layout-mode). 1× tekenen, cachen als bitmap.
2. `cellLayer` — gevulde cellen + areas. Pas updaten bij wijziging (geen full redraw).
3. `uiLayer` — selection, hover, paint preview, drag rubber-band.

**Performance principes:**
- `Konva.Stage.batchDraw()` na bulk wijzigingen
- `Konva.Layer.listening(false)` op grid layer (geen events)
- Areas als 1 `Konva.Group` per area (1 hit-test target ipv N cellen)
- Viewport culling: alleen render wat zichtbaar is bij heel grote yards
- Re-use Konva nodes ipv recreate

## Touch + Mouse support

- Pinch-zoom (2 vingers) + mousewheel zoom
- 1-vinger drag = pan; 1-finger tap = select
- 2 vingers = pan + zoom
- In edit mode: drag = paint cellen (rubber band)
- Long-press = context menu (mobile)
- Right-click = context menu (desktop)

## Offline gedrag
- Service worker (vite-plugin-pwa) cacht alle assets
- Eerste load: assets cached
- Subsequent loads: instant uit cache (cache-first voor static, network-first voor `/api/`)
- Wijzigingen → IndexedDB → pending queue → sync wanneer online
- Online status detectie: `navigator.onLine` + ping naar `/api/state` heartbeat

## Build & deploy
- `cd frontend && npm run build` → output naar `../public/`
- Express serveert `public/`
- Backend port 3006, intranet only
- Geen externe domeinen nodig
