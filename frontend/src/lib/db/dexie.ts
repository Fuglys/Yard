// IndexedDB schema via Dexie. Houdt areas/cells lokaal bij + een queue van pending changes voor sync.
import Dexie, { type Table } from 'dexie';

export interface AreaRow {
  id: number | string;     // string voor temp IDs (tmp-xxx) tot server een echte toekent
  name: string;
  area_type: string;       // 'wall' | 'container' | 'afval' | 'bunker' | 'zak' | 'custom'
  color?: string | null;
  material_name?: string | null;
  material_id?: number | null;
  metadata?: Record<string, any>;
  updated_at: number;
  deleted_at?: number | null;
}

export interface CellRow {
  key: string;             // "col,row" — primary key
  col: number;
  row: number;
  area_id?: number | string | null;
  cell_type: string;       // 'empty' | 'wall' | 'container' | 'afval' | 'bunker' | 'zak' | 'zak-num' | 'custom'
  label?: string;
  meta?: Record<string, any>;
  updated_at: number;
  deleted_at?: number | null;
}

export interface PendingChange {
  id?: number;             // auto-increment
  ts: number;
  kind: 'area' | 'cell';
  op: 'upsert' | 'delete';
  payload: Record<string, any>;
}

export interface KV {
  key: string;
  value: any;
}

class YardDB extends Dexie {
  areas!: Table<AreaRow, number | string>;
  cells!: Table<CellRow, string>;
  pending!: Table<PendingChange, number>;
  kv!: Table<KV, string>;

  constructor() {
    super('yard_manager_v2');
    this.version(1).stores({
      areas:   'id, area_type, updated_at, deleted_at',
      cells:   'key, area_id, cell_type, [col+row], updated_at, deleted_at',
      pending: '++id, ts, kind',
      kv:      'key',
    });
  }
}

export const db = new YardDB();

// ── Helpers ────────────────────────────────────────────────────────────
export const cellKey = (col: number, row: number) => `${col},${row}`;

export async function getKV<T = any>(key: string, fallback: T): Promise<T> {
  const r = await db.kv.get(key);
  return r ? (r.value as T) : fallback;
}

export async function setKV(key: string, value: any) {
  await db.kv.put({ key, value });
}
