// UI-state stores (mode, viewport, selection, paint tool, etc.)
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

export type Mode = 'view' | 'layout';
export const modeStore = createStore<Mode>('view');

export const authStore = createStore<{ username: string; role: string } | null>(null);

export type PaintTool =
  | { type: 'none' }
  | { type: 'select' }
  | { type: 'background' }
  | { type: 'wall' }
  | { type: 'container'; label?: string }
  | { type: 'afval'; label?: string }
  | { type: 'bunker'; label?: string; color?: string }
  | { type: 'zak' }
  | { type: 'custom'; label: string; color: string; areaType?: string }
  | { type: 'pick-area' }
  | { type: 'eraser' };

export const paintToolStore = createStore<PaintTool>({ type: 'none' });

export const viewportStore = createStore<{ scale: number; panX: number; panY: number }>({
  scale: 1, panX: 0, panY: 0,
});

export const selectionStore = createStore<Set<string>>(new Set());

export const toastStore = createStore<{ message: string; ts: number } | null>(null);
export function toast(message: string) {
  toastStore.set({ message, ts: Date.now() });
  setTimeout(() => {
    if (toastStore.get()?.message === message) toastStore.set(null);
  }, 2500);
}

export const editPanelOpen = createStore<boolean>(false);
export const inspectorAreaId = createStore<number | string | null>(null);

// Lock paint-richting (handig op tablet zonder Shift-toets)
export const lineLockStore = createStore<boolean>(false);

// Penseelgrootte (cellen breed × hoog) — gecentreerd op de pointer
export const brushSizeStore = createStore<{ w: number; h: number }>({ w: 1, h: 1 });

// Zak-nummering oriëntatie. 'h' = nummers per kolom, 'v' = nummers per rij
export const zakOrientationStore = createStore<'h' | 'v'>('h');
// Rijnummer voor de volgende zakken-rij die geplaatst wordt. Gebruiker vult zelf in.
export const zakRijNumStore = createStore<number>(1);

// Inline place+assign flow: id van het laatst geplaatste vlak
export const lastPlacedAreaId = createStore<number | string | null>(null);

// Bulk hertoewijzen drawer (open/dicht)
export const bulkDrawerOpen = createStore<boolean>(false);

// Achtergrond-afbeelding state (alleen zichtbaar in Indeling-modus)
export type BackgroundImageState = {
  visible: boolean;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  initialized: boolean;
};

const BG_STORAGE_KEY = 'yard_backgroundImage';
function loadBgImageInitial(): BackgroundImageState {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const scale = Number.isFinite(Number(p.scale)) ? Number(p.scale) : 1;
      return {
        visible: !!p.visible,
        x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
        y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
        opacity: Number.isFinite(Number(p.opacity)) ? Number(p.opacity) : 0.7,
        scale: Math.max(0.1, Math.min(5, scale)),
        initialized: !!p.initialized,
      };
    }
  } catch {}
  return { visible: false, x: 0, y: 0, opacity: 0.7, scale: 1, initialized: false };
}

export const backgroundImageStore = createStore<BackgroundImageState>(loadBgImageInitial());

// Persist on every change
backgroundImageStore.subscribe((v) => {
  try { localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(v)); } catch {}
});
