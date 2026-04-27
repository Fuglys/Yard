# Yard Manager v2

Snelle, offline-first yard management tool. Draait op intranet, geen externe toegang nodig.

## Stack

- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: Svelte 5 + Vite + Konva (canvas) + Dexie (IndexedDB)
- **Sync**: Per-cel diff push + SSE realtime pull (tussen meerdere tablets)
- **PWA**: Service worker via vite-plugin-pwa, werkt offline

## Folder structuur

```
yard-manager/
├── server.js            # Express entry — mount routes
├── lib/                 # backend libs (db pools, event bus)
├── routes/              # backend route modules
├── migrations/          # SQL migraties + runner
├── frontend/            # Svelte source — npm run build → public/
├── public/              # build output (door Express geserveerd)
├── public-legacy/       # backup van oude vanilla JS versie
├── .env                 # DB + port config
└── package.json         # backend deps
```

## Database

Twee databases (host: localhost:5432):
- `yard_db` — eigen state: `areas`, `cells`, `area_contents` (v2) + legacy tabellen
- `dagstart_db` — read-only: `materials`, `users` (auth)

Schema toepassen / bijwerken:
```bash
node migrations/run.js
```
Veilig her-uitvoerbaar (alle DDL is `IF NOT EXISTS`).

## Backend draaien

```bash
node server.js
# of: npm start
```
Default port `3006` (override via `PORT=3007 node server.js`).

## Frontend ontwikkelen

```bash
cd frontend
npm install
npm run dev    # dev server op :5173 met proxy naar :3006
npm run build  # productie build → ../public/
```

## API endpoints (v2)

| Methode | Pad | Doel |
|---------|-----|------|
| GET | `/api/health` | Health + #connected SSE clients |
| GET | `/api/state` | Volledige snapshot (areas + cells) |
| GET | `/api/state/since?ts=N` | Diff sinds timestamp |
| POST | `/api/sync/v2` | Push diffs (areas + cells, op: upsert/delete) |
| GET | `/api/events` | SSE stream voor realtime updates |
| GET | `/api/materials` | Materialen uit dagstart_db (niet-test, actief) |
| POST | `/api/auth/login` | Admin/supervisor login via dagstart_db |

Legacy endpoints (`/api/cells`, `/api/sync`, `/api/balen`, `/api/layout`) blijven bestaan voor backward compat.

## Modes (frontend)

1. **Overzicht** — bekijken alleen
2. **Inhoud** — admin: materiaal toewijzen aan een vlak (area)
3. **Indeling** — admin: yard layout schilderen (muren, areas, cellen)

## Belangrijke kenmerken

- **Local first**: alle wijzigingen gaan eerst naar IndexedDB, daarna gequeued voor sync
- **Conflict resolution**: last-write-wins per entity op `updated_at`
- **Realtime tussen tablets**: server broadcast via SSE, andere tablets pullen incremental diff
- **Aaneensluitende cellen** met dezelfde area worden visueel gegroepeerd; opsplitsen via Area Inspector
- **Touch + muis**: pinch-zoom, pan met sleep, paint met sleep

## Performance

- Canvas rendering (Konva) ipv 12.500 DOM elements
- Per-shape diff updates ipv volledige re-render
- Bulk DB operaties via `bulkPut` / `bulkDelete`
- Batched draw via `Konva.Layer.batchDraw()`

## Cutover van oude versie

De oude versie (`public-legacy/`) blijft beschikbaar als backup. De v2 server is **backward compatible**: oude tablets blijven werken via de legacy endpoints totdat ze hun cache verversen.

Om volledig over te schakelen:
1. Hard refresh op alle tablets (Ctrl+Shift+R / pull to refresh)
2. Oude service worker wordt automatisch vervangen door nieuwe (`autoUpdate`)
3. Oude tablets die geen updates krijgen, blijven gewoon werken via legacy endpoints
