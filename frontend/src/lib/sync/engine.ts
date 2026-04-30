// Sync engine — pushed pending changes naar server, listent op SSE voor pulls.
import { db, getKV, setKV } from '../db/dexie';
import { applyServerDiff, applyIdMap, hydrate, pendingCount, onlineStore, lastSyncTs } from '../stores/state';
import { toast } from '../stores/ui';

const CLIENT_ID = (() => {
  let id = localStorage.getItem('yardClientId');
  if (!id) {
    id = `c-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('yardClientId', id);
  }
  return id;
})();

let pushTimer: number | null = null;
let pushing = false;
let sse: EventSource | null = null;

// Validatie: filter bad entries voor verzending zodat server niet crasht op slechte data
function isValidCellPayload(p: any): boolean {
  if (!p) return false;
  if (typeof p.col !== 'number' || typeof p.row !== 'number') return false;
  if (!Number.isInteger(p.col) || !Number.isInteger(p.row)) return false;
  if (p.col < 0 || p.row < 0 || p.col > 1000 || p.row > 1000) return false;
  return true;
}
function isValidAreaPayload(p: any): boolean {
  if (!p) return false;
  if (p.id == null) return false;
  return true;
}

// ── Push loop ─────────────────────────────────────────────────────────
async function pushNow(): Promise<void> {
  if (pushing) return;
  if (!navigator.onLine) return;
  pushing = true;
  try {
    const pending = await db.pending.orderBy('id').limit(500).toArray();
    if (pending.length === 0) return;

    const areas: any[] = [];
    const cells: any[] = [];
    const skippedIds: number[] = [];
    for (const p of pending) {
      const payload = { op: p.op, ...p.payload };
      if (p.kind === 'area') {
        if (isValidAreaPayload(payload)) areas.push(payload);
        else { skippedIds.push(p.id!); console.warn('[sync] dropping invalid area payload', payload); }
      } else {
        if (isValidCellPayload(payload)) cells.push(payload);
        else { skippedIds.push(p.id!); console.warn('[sync] dropping invalid cell payload', payload); }
      }
    }
    // Verwijder ongeldige entries direct (anders blijven ze elke push falen)
    if (skippedIds.length) await db.pending.bulkDelete(skippedIds);

    if (areas.length === 0 && cells.length === 0) return;

    const res = await fetch('/api/sync/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID, areas, cells }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[sync] HTTP', res.status, body.slice(0, 500));
      throw new Error(`HTTP ${res.status}`);
    }
    const result = await res.json();

    if (result.errors?.length) {
      console.warn('[sync] server reported failed rows:', result.errors);
    }

    // Conflict-detectie: server meldt apart hoeveel upserts verloren hebben
    // van een nieuwere versie op de server. Gebruiker krijgt een toast zodat
    // hij weet dat een offline-edit overschreven is door iemand anders.
    const conflicts = (result.areas?.conflicts || 0) + (result.cells?.conflicts || 0);
    if (conflicts > 0) {
      toast(`${conflicts} wijziging${conflicts === 1 ? '' : 'en'} overschreven — server had nieuwere versie`);
    }

    // Vervang temp IDs door server IDs
    if (result.areas?.idMap && Object.keys(result.areas.idMap).length) {
      await applyIdMap(result.areas.idMap);
    }

    // Verwijder verwerkte pending entries
    await db.pending.bulkDelete(pending.filter((p) => !skippedIds.includes(p.id!)).map((p) => p.id!));
    pendingCount.set(await db.pending.count());
    lastSyncTs.set(result.ts || Date.now());
    await setKV('lastSyncTs', result.ts || Date.now());
  } catch (err) {
    console.warn('Sync push failed:', err);
  } finally {
    pushing = false;
  }
}

// Globaal toegankelijk voor debug/handmatig opruimen
if (typeof window !== 'undefined') {
  (window as any).__yardClearPendingQueue = async () => {
    const n = await db.pending.count();
    await db.pending.clear();
    pendingCount.set(0);
    console.log(`[sync] cleared ${n} pending entries`);
    return n;
  };
}

// Default debounce raised from 500ms → 1200ms to batch chained mutations
// (paint strokes, multi-cell upserts). Tests do not depend on this timing.
export function schedulePush(delayMs = 1200) {
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { pushTimer = null; pushNow(); }, delayMs);
}

// ── Pull diff ─────────────────────────────────────────────────────────
export async function pullDiff() {
  if (!navigator.onLine) return;
  const since = await getKV<number>('lastSyncTs', 0);
  try {
    const res = await fetch(`/api/state/since?ts=${since}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if ((payload.areas?.length || 0) + (payload.cells?.length || 0) > 0) {
      await applyServerDiff(payload);
      await setKV('lastSyncTs', payload.ts);
    } else {
      lastSyncTs.set(payload.ts);
      await setKV('lastSyncTs', payload.ts);
    }
  } catch (err) {
    console.warn('Sync pull failed:', err);
  }
}

// ── Full sync (initial of na lange offline) ─────────────────────────
export async function fullSync() {
  if (!navigator.onLine) return;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    // Wis lokale state, herlaad
    await db.transaction('rw', db.areas, db.cells, async () => {
      await db.areas.clear();
      await db.cells.clear();
      for (const a of payload.areas || []) await db.areas.put(a);
      for (const c of payload.cells || []) {
        await db.cells.put({ ...c, key: `${c.col},${c.row}` });
      }
    });
    await hydrate();
    lastSyncTs.set(payload.ts);
    await setKV('lastSyncTs', payload.ts);
  } catch (err) {
    console.warn('Full sync failed:', err);
    toast('Server niet bereikbaar — werk offline');
  }
}

// Hard wipe: server heeft alle data verwijderd → lokaal ook wissen + state resetten
async function wipeLocal() {
  try {
    await db.transaction('rw', db.areas, db.cells, db.pending, async () => {
      await db.cells.clear();
      await db.areas.clear();
      await db.pending.clear();
    });
    await setKV('lastSyncTs', 0);
    await hydrate();
    pendingCount.set(0);
    lastSyncTs.set(0);
    console.log('[sync] local data wiped (server broadcast)');
  } catch (e) {
    console.warn('Local wipe failed:', e);
  }
}

// ── SSE realtime ─────────────────────────────────────────────────────
function connectSSE() {
  if (sse) { try { sse.close(); } catch (_) {} }
  sse = new EventSource(`/api/events?clientId=${CLIENT_ID}`);
  sse.addEventListener('hello', () => { onlineStore.set(true); });
  sse.addEventListener('state-changed', () => { pullDiff(); });
  sse.addEventListener('wiped', () => { wipeLocal(); });
  sse.onerror = () => {
    onlineStore.set(false);
    if (sse) { try { sse.close(); } catch (_) {} sse = null; }
    setTimeout(() => { if (navigator.onLine) connectSSE(); }, 5000);
  };
}

// Globaal voor handmatig wissen vanuit DevTools console:
//   __yardWipeAll()  ← wist server + alle clients
if (typeof window !== 'undefined') {
  (window as any).__yardWipeAll = async () => {
    if (!confirm('Server + ALLE tablets leegmaken? Niet ongedaan te maken.')) return;
    try {
      const res = await fetch('/api/wipe-layout', { method: 'POST' });
      const j = await res.json();
      console.log('[wipe] server response:', j);
      // Lokaal ook (mocht SSE gemist worden)
      await wipeLocal();
    } catch (e) { console.warn('Wipe failed:', e); }
  };
}

// ── Init ──────────────────────────────────────────────────────────────
export async function startSync() {
  // Initial: hydrate uit IndexedDB, dan online sync
  await hydrate();
  if (navigator.onLine) {
    const since = await getKV<number>('lastSyncTs', 0);
    // Full sync als er nog nooit gesynchroniseerd is, of als de lokale data leeg is
    const localCells = await db.cells.count();
    if (since === 0 || localCells === 0) await fullSync(); else await pullDiff();
    connectSSE();
    schedulePush(100);
  }
  window.addEventListener('online', () => {
    onlineStore.set(true);
    pullDiff();
    schedulePush(200);
    connectSSE();
  });
  window.addEventListener('offline', () => {
    onlineStore.set(false);
    if (sse) { try { sse.close(); } catch (_) {} sse = null; }
  });

  // Periodieke push als fallback
  setInterval(() => { if (navigator.onLine) pushNow(); }, 5000);

  // Health-ping elke 15s — `navigator.onLine` is onbetrouwbaar (kan 'true'
  // zijn op wifi zonder echte internet). Een echte HEAD/GET naar /api/health
  // bewijst dat de server bereikbaar is. Bij flip offline → online triggeren
  // we een pull + push zodat alles direct ingehaald wordt.
  let healthOk = navigator.onLine;
  setInterval(async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const wasOffline = !healthOk;
      healthOk = true;
      onlineStore.set(true);
      if (wasOffline) {
        // Net teruggekomen — haal diff op + flush pending. SSE re-connecten.
        pullDiff();
        schedulePush(200);
        if (!sse) connectSSE();
      }
    } catch {
      healthOk = false;
      onlineStore.set(false);
    }
  }, 15000);
}
