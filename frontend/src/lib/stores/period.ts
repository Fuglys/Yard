// Period model — backbone voor inhoud-mode jaarplanner.
// Areas dragen per-periode materiaal-toewijzingen in metadata.periods[periodKey].
// area.material_name blijft de "huidige" weergave-waarde voor canvas-coloring.
import type { AreaRow } from '../db/dexie';
import { areasStore, upsertArea } from './state';
import { schedulePush } from '../sync/engine';

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

export interface ReadableStore<T> {
  get(): T;
  subscribe(fn: (v: T) => void): () => void;
}

const STORAGE_KEY = 'yard_currentPeriod';

export function derivePeriodFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0..11
  const q = Math.floor(m / 3) + 1;
  return `${y}-Q${q}`;
}

function loadInitialPeriod(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && /^\d{4}-Q[1-4]$/.test(raw)) return raw;
  } catch {}
  return derivePeriodFromDate(new Date());
}

export const currentPeriodStore = createStore<string>(loadInitialPeriod());

// Persist on change
currentPeriodStore.subscribe((v) => {
  try { localStorage.setItem(STORAGE_KEY, v); } catch {}
});

// "2026-Q2" → "Q2 2026"
export function formatPeriod(p: string): string {
  if (!p) return '';
  const m = p.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return p;
  return `Q${m[2]} ${m[1]}`;
}

// "2026-Q2" → { year: 2026, q: 2 }
export function parsePeriod(p: string): { year: number; q: number } | null {
  const m = p.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), q: Number(m[2]) };
}

// Geef alle latere quartalen in hetzelfde jaar (Q3, Q4 als nu Q2 is)
export function laterQuartersInYear(p: string): string[] {
  const parsed = parsePeriod(p);
  if (!parsed) return [];
  const out: string[] = [];
  for (let q = parsed.q + 1; q <= 4; q++) {
    out.push(`${parsed.year}-Q${q}`);
  }
  return out;
}

// Lees materiaal voor een area in een gegeven periode.
// Fallback: als er geen periode-entry is, val terug op area.material_name (oude data).
export function getMaterialForAreaInPeriod(area: AreaRow | null | undefined, period?: string): string | null {
  if (!area) return null;
  const p = period || currentPeriodStore.get();
  const periods = area.metadata?.periods;
  if (periods && typeof periods === 'object' && periods[p]) {
    const entry = periods[p];
    if (entry && typeof entry === 'object') {
      return entry.material_name ?? null;
    }
  }
  // Backwards-compat: oude areas zonder metadata.periods
  return area.material_name ?? null;
}

// Schrijf materiaal voor een area in een periode. Update óók area.material_name
// zodat canvas-rendering (die nog op material_name leest) blijft werken.
export async function setMaterialForArea(
  areaId: number | string,
  materialName: string | null,
  period?: string,
): Promise<void> {
  const area = areasStore.get().get(areaId);
  if (!area) return;
  const p = period || currentPeriodStore.get();
  const now = Date.now();

  const prevMeta = (area.metadata && typeof area.metadata === 'object') ? area.metadata : {};
  const prevPeriods = (prevMeta.periods && typeof prevMeta.periods === 'object') ? prevMeta.periods : {};
  const nextPeriods = {
    ...prevPeriods,
    [p]: { material_name: materialName, set_at: now },
  };
  const nextMeta = {
    ...prevMeta,
    periods: nextPeriods,
    lastFilled: now,
  };

  const updated: AreaRow = {
    ...area,
    metadata: nextMeta,
    // Convenience: canvas blijft op material_name lezen — sync in voor huidige periode
    material_name: (period && period !== currentPeriodStore.get()) ? area.material_name : materialName,
    updated_at: now,
  };

  await upsertArea(updated);
  schedulePush();
}
