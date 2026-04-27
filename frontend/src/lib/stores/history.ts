// Undo/redo geschiedenis — snapshots per logische actie (paint-stroke, brush-click, move, resize, area-edit).
// Hooks vanuit state.ts (`registerHistoryHooks`) zorgen dat elke mutatie automatisch
// de oude waarden vastlegt voordat ze worden overschreven.

import type { AreaRow, CellRow } from '../db/dexie';
import { cellsStore, areasStore, upsertArea, deleteArea, upsertCells, deleteCells } from './state';
import { schedulePush } from '../sync/engine';

type CellSnap = CellRow | null; // null = was leeg / niet aanwezig
type AreaSnap = AreaRow | null;

interface Snapshot {
  cells: Map<string, CellSnap>;
  areas: Map<number | string, AreaSnap>;
}

interface Step {
  desc: string;
  before: Snapshot;
  after: Snapshot;
}

interface OpenStep {
  desc: string;
  cellKeys: Set<string>;
  areaIds: Set<number | string>;
  before: Snapshot;
}

type Listener = (state: { canUndo: boolean; canRedo: boolean; pastDesc?: string; futureDesc?: string }) => void;

class HistoryStack {
  past: Step[] = [];
  future: Step[] = [];
  open: OpenStep | null = null;
  applying = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }
  private snapshot() {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      pastDesc: this.past[this.past.length - 1]?.desc,
      futureDesc: this.future[this.future.length - 1]?.desc,
    };
  }
  private notify() {
    const s = this.snapshot();
    this.listeners.forEach((l) => l(s));
  }

  begin(desc: string) {
    if (this.open) this.commit(); // veiligheid
    this.open = {
      desc,
      cellKeys: new Set(),
      areaIds: new Set(),
      before: { cells: new Map(), areas: new Map() },
    };
  }

  trackCell(col: number, row: number) {
    if (!this.open || this.applying) return;
    const key = `${col},${row}`;
    if (this.open.cellKeys.has(key)) return;
    this.open.cellKeys.add(key);
    const cur = cellsStore.get().get(key);
    this.open.before.cells.set(key, cur ? { ...cur, meta: { ...(cur.meta || {}) } } : null);
  }

  trackArea(id: number | string) {
    if (!this.open || this.applying) return;
    if (this.open.areaIds.has(id)) return;
    this.open.areaIds.add(id);
    const cur = areasStore.get().get(id);
    this.open.before.areas.set(id, cur ? { ...cur, metadata: { ...(cur.metadata || {}) } } : null);
  }

  commit() {
    if (!this.open) return;
    if (this.open.cellKeys.size === 0 && this.open.areaIds.size === 0) {
      this.open = null;
      return;
    }
    const after: Snapshot = { cells: new Map(), areas: new Map() };
    for (const key of this.open.cellKeys) {
      const cur = cellsStore.get().get(key);
      after.cells.set(key, cur ? { ...cur, meta: { ...(cur.meta || {}) } } : null);
    }
    for (const id of this.open.areaIds) {
      const cur = areasStore.get().get(id);
      after.areas.set(id, cur ? { ...cur, metadata: { ...(cur.metadata || {}) } } : null);
    }
    // Detecteer no-op (before === after voor alle keys) en sla over
    let realChange = false;
    for (const key of this.open.cellKeys) {
      const b = this.open.before.cells.get(key);
      const a = after.cells.get(key);
      if (JSON.stringify(b) !== JSON.stringify(a)) { realChange = true; break; }
    }
    if (!realChange) {
      for (const id of this.open.areaIds) {
        const b = this.open.before.areas.get(id);
        const a = after.areas.get(id);
        if (JSON.stringify(b) !== JSON.stringify(a)) { realChange = true; break; }
      }
    }
    if (!realChange) {
      console.log('[history] commit skipped (no real change)', { desc: this.open.desc });
      this.open = null;
      return;
    }
    this.past.push({ desc: this.open.desc, before: this.open.before, after });
    this.future = [];
    console.log('[history] commit', { desc: this.open.desc, cells: this.open.cellKeys.size, areas: this.open.areaIds.size, pastSize: this.past.length });
    this.open = null;
    if (this.past.length > 100) this.past.shift();
    this.notify();
  }

  cancel() { this.open = null; }

  async undo(): Promise<boolean> {
    if (this.open) this.commit();
    const step = this.past.pop();
    console.log('[history] undo', { hasStep: !!step, desc: step?.desc, pastSize: this.past.length, futureSize: this.future.length });
    if (!step) return false;
    await this.applySnap(step.before);
    this.future.push(step);
    this.notify();
    return true;
  }

  async redo(): Promise<boolean> {
    const step = this.future.pop();
    console.log('[history] redo', { hasStep: !!step, desc: step?.desc, pastSize: this.past.length, futureSize: this.future.length });
    if (!step) return false;
    await this.applySnap(step.after);
    this.past.push(step);
    this.notify();
    return true;
  }

  private async applySnap(snap: Snapshot) {
    this.applying = true;
    try {
      // Areas: eerste handlen (zodat cells naar bestaande areas kunnen verwijzen)
      for (const [id, area] of snap.areas) {
        if (area === null) {
          // Was er nog niet → verwijderen indien nu wel aanwezig
          if (areasStore.get().has(id)) await deleteArea(id);
        } else {
          await upsertArea({ ...area });
        }
      }
      // Cells
      const toUpsert: Array<Omit<CellRow, 'key'>> = [];
      const toDelete: Array<{ col: number; row: number }> = [];
      for (const [key, cell] of snap.cells) {
        if (cell === null) {
          const [c, r] = key.split(',').map(Number);
          toDelete.push({ col: c, row: r });
        } else {
          toUpsert.push({
            col: cell.col, row: cell.row,
            area_id: cell.area_id ?? null,
            cell_type: cell.cell_type,
            label: cell.label || '',
            meta: cell.meta || {},
            updated_at: Date.now(),
          });
        }
      }
      if (toDelete.length) await deleteCells(toDelete);
      if (toUpsert.length) await upsertCells(toUpsert);
      schedulePush();
    } finally {
      this.applying = false;
    }
  }
}

export const history = new HistoryStack();

// ── Hooks publiceren naar state.ts (zonder circular import) ─────
import { registerHistoryHooks } from './state';
registerHistoryHooks({
  trackCell: (col, row) => history.trackCell(col, row),
  trackArea: (id) => history.trackArea(id),
  isApplying: () => history.applying,
});
