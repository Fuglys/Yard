// Reactive state: areas + cells, geladen vanuit IndexedDB, gemuteerd via repository.
import { db, cellKey, type AreaRow, type CellRow, type PendingChange } from '../db/dexie';

// Eigen mini-store-pattern (geen svelte store import om SSR/test simpel te houden).
type Listener<T> = (value: T) => void;
function createStore<T>(initial: T) {
  let val = initial;
  const subs = new Set<Listener<T>>();
  return {
    get: () => val,
    set: (v: T) => { val = v; subs.forEach((s) => s(val)); },
    update: (fn: (v: T) => T) => { val = fn(val); subs.forEach((s) => s(val)); },
    subscribe: (s: Listener<T>) => { subs.add(s); s(val); return () => subs.delete(s); },
  };
}

export const areasStore = createStore<Map<number | string, AreaRow>>(new Map());
export const cellsStore = createStore<Map<string, CellRow>>(new Map());
export const pendingCount = createStore<number>(0);
export const onlineStore = createStore<boolean>(navigator.onLine);
export const lastSyncTs = createStore<number>(0);

let tmpIdCounter = -1;
export function nextTempId(): string {
  return `tmp-${Date.now()}-${tmpIdCounter--}`;
}

// ── History hooks (zonder circulaire import) ──────────────────────────
let _trackCell: (col: number, row: number) => void = () => {};
let _trackArea: (id: number | string) => void = () => {};
let _isApplying: () => boolean = () => false;
export function registerHistoryHooks(hooks: {
  trackCell: (col: number, row: number) => void;
  trackArea: (id: number | string) => void;
  isApplying: () => boolean;
}) {
  _trackCell = hooks.trackCell;
  _trackArea = hooks.trackArea;
  _isApplying = hooks.isApplying;
}

// ── Initial load uit IndexedDB ────────────────────────────────────────
export async function hydrate() {
  const [areas, cells, pcount] = await Promise.all([
    db.areas.toArray(),
    db.cells.toArray(),
    db.pending.count(),
  ]);
  const aMap = new Map<number | string, AreaRow>();
  areas.forEach((a) => { if (!a.deleted_at) aMap.set(a.id, a); });
  const cMap = new Map<string, CellRow>();
  cells.forEach((c) => { if (!c.deleted_at) cMap.set(c.key, c); });
  areasStore.set(aMap);
  cellsStore.set(cMap);
  pendingCount.set(pcount);
}

// ── Mutaties — IN-MEMORY EERST (sync), daarna async naar IndexedDB + sync queue ──
// Dit voorkomt race conditions met undo/redo: cellsStore is altijd direct na mutatie current.
async function bumpPendingCount() {
  try { pendingCount.set(await db.pending.count()); } catch {}
}

export async function upsertArea(area: AreaRow, queueForSync = true) {
  if (!_isApplying()) _trackArea(area.id);
  area.updated_at = Date.now();
  // SYNC: in-memory state direct bijwerken
  areasStore.update((m) => { const n = new Map(m); n.set(area.id, area); return n; });
  // ASYNC: persisteren
  try {
    await db.areas.put(area);
    if (queueForSync) {
      await db.pending.add({ ts: area.updated_at, kind: 'area', op: 'upsert', payload: area });
      bumpPendingCount();
    }
  } catch (e) { console.warn('upsertArea persist:', e); }
}

export async function deleteArea(id: number | string, queueForSync = true) {
  if (!_isApplying()) _trackArea(id);
  const ts = Date.now();
  areasStore.update((m) => { const n = new Map(m); n.delete(id); return n; });
  try {
    await db.areas.update(id, { deleted_at: ts, updated_at: ts });
    if (queueForSync) {
      await db.pending.add({ ts, kind: 'area', op: 'delete', payload: { id, updated_at: ts } });
      bumpPendingCount();
    }
  } catch (e) { console.warn('deleteArea persist:', e); }
}

export async function upsertCell(cell: Omit<CellRow, 'key'>, queueForSync = true) {
  if (!_isApplying()) _trackCell(cell.col, cell.row);
  const key = cellKey(cell.col, cell.row);
  const full: CellRow = { ...cell, key, updated_at: Date.now() };
  cellsStore.update((m) => { const n = new Map(m); n.set(key, full); return n; });
  try {
    await db.cells.put(full);
    if (queueForSync) {
      await db.pending.add({ ts: full.updated_at, kind: 'cell', op: 'upsert', payload: full });
      bumpPendingCount();
    }
  } catch (e) { console.warn('upsertCell persist:', e); }
}

export async function upsertCells(cells: Array<Omit<CellRow, 'key'>>, queueForSync = true) {
  if (!_isApplying()) for (const c of cells) _trackCell(c.col, c.row);
  const ts = Date.now();
  const full = cells.map((c) => ({ ...c, key: cellKey(c.col, c.row), updated_at: ts }));
  cellsStore.update((m) => { const n = new Map(m); for (const c of full) n.set(c.key, c); return n; });
  try {
    await db.cells.bulkPut(full);
    if (queueForSync && full.length) {
      await db.pending.bulkAdd(full.map((c) => ({ ts, kind: 'cell' as const, op: 'upsert' as const, payload: c })));
      bumpPendingCount();
    }
  } catch (e) { console.warn('upsertCells persist:', e); }
}

export async function deleteCell(col: number, row: number, queueForSync = true) {
  if (!_isApplying()) _trackCell(col, row);
  const key = cellKey(col, row);
  const ts = Date.now();
  cellsStore.update((m) => { const n = new Map(m); n.delete(key); return n; });
  try {
    await db.cells.update(key, { deleted_at: ts, updated_at: ts });
    if (queueForSync) {
      await db.pending.add({ ts, kind: 'cell', op: 'delete', payload: { col, row, updated_at: ts } });
      bumpPendingCount();
    }
  } catch (e) { console.warn('deleteCell persist:', e); }
}

export async function deleteCells(coords: Array<{ col: number; row: number }>, queueForSync = true) {
  if (!_isApplying()) for (const c of coords) _trackCell(c.col, c.row);
  const ts = Date.now();
  const keys = coords.map((c) => cellKey(c.col, c.row));
  cellsStore.update((m) => { const n = new Map(m); keys.forEach((k) => n.delete(k)); return n; });
  try {
    await db.cells.bulkUpdate(keys.map((k) => ({ key: k, changes: { deleted_at: ts, updated_at: ts } })));
    if (queueForSync && coords.length) {
      await db.pending.bulkAdd(coords.map((c) => ({ ts, kind: 'cell' as const, op: 'delete' as const, payload: { col: c.col, row: c.row, updated_at: ts } })));
      bumpPendingCount();
    }
  } catch (e) { console.warn('deleteCells persist:', e); }
}

// Apply server diff (zonder queue, want is van server)
// Performance: selective in-memory patch — only touched areas/cells get re-pushed
// through the stores. Avoids reading the full DB on every SSE event.
export async function applyServerDiff(payload: { areas: AreaRow[]; cells: any[]; ts: number }) {
  const aWrites: AreaRow[] = [];
  const aDeletes: (number | string)[] = [];
  for (const a of payload.areas || []) {
    const local = await db.areas.get(a.id);
    if (local && local.updated_at >= (a.updated_at || 0)) continue;
    if (a.deleted_at) aDeletes.push(a.id);
    else aWrites.push(a);
  }

  const cWrites: CellRow[] = [];
  const cDeletes: string[] = [];
  for (const c of payload.cells || []) {
    const key = cellKey(c.col, c.row);
    const local = await db.cells.get(key);
    if (local && local.updated_at >= (c.updated_at || 0)) continue;
    if (c.deleted_at) cDeletes.push(key);
    else cWrites.push({ ...c, key });
  }

  if (aWrites.length) await db.areas.bulkPut(aWrites);
  if (aDeletes.length) await db.areas.bulkDelete(aDeletes);
  if (cWrites.length) await db.cells.bulkPut(cWrites);
  if (cDeletes.length) await db.cells.bulkDelete(cDeletes);

  // Selective patch in-memory stores — no full re-hydrate
  if (aWrites.length || aDeletes.length) {
    const aMap = new Map(areasStore.get());
    for (const a of aWrites) aMap.set(a.id, a);
    for (const id of aDeletes) aMap.delete(id);
    areasStore.set(aMap);
  }
  if (cWrites.length || cDeletes.length) {
    const cMap = new Map(cellsStore.get());
    for (const c of cWrites) cMap.set(c.key, c);
    for (const k of cDeletes) cMap.delete(k);
    cellsStore.set(cMap);
  }
  lastSyncTs.set(payload.ts);
}

// Replace temp IDs (tmp-xxx) with server-assigned real IDs
export async function applyIdMap(idMap: Record<string, number>) {
  if (!idMap || !Object.keys(idMap).length) return;
  for (const [tmpId, realId] of Object.entries(idMap)) {
    const area = await db.areas.get(tmpId);
    if (area) {
      await db.areas.delete(tmpId);
      await db.areas.put({ ...area, id: realId });
    }
    // Update cells referring to this temp ID
    const refs = await db.cells.where('area_id').equals(tmpId).toArray();
    for (const c of refs) {
      await db.cells.put({ ...c, area_id: realId });
    }
  }
  await hydrate();
}
