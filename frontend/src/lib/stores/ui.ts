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
// Houdt bij welke sub-area net is aangemaakt door een view-selectie.
// Bij annuleren (sluiten zonder opslaan) wordt deze teruggedraaid.
export const pendingSubAreaId = createStore<number | string | null>(null);

// Pending selectie: cellen die geselecteerd zijn in overzicht maar nog niet opgeslagen.
// De inspector opent in "nieuw" of "extend" modus. Pas bij opslaan wordt de
// sub-area aangemaakt of uitgebreid.
export interface PendingSelection {
  cells: Array<{ col: number; row: number; cell_type: string; area_id: number | string | null }>;
  parentColor: string | null;
  // Wanneer non-null: deze selectie sluit aan op (of bevat) een bestaande
  // sub-area met materiaal. Bij Opslaan voegen we de cellen aan die area toe
  // i.p.v. een nieuwe area aan te maken. Het materiaal/qty/datum-formulier
  // wordt vooraf gevuld met de waarden van die area.
  mergeIntoAreaId: number | string | null;
  mergeIntoMaterial: string | null;
  mergeIntoQuantity: number | null;
  mergeIntoDate: string | null;
}
export const pendingSelectionStore = createStore<PendingSelection | null>(null);

// Sub-selectie: cellen die binnen een bestaande sub-area zijn geselecteerd
// (rubber-band volledig binnen die area). Gebruikt om deelverwijderen mogelijk
// te maken: knop "Verwijder geselecteerde cellen" in de inspector geeft alleen
// deze cellen terug aan de parent bunker, zonder de hele area te verwijderen.
export const subSelectionCellsStore = createStore<Array<{ col: number; row: number }> | null>(null);

// Lock paint-richting (handig op tablet zonder Shift-toets)
export const lineLockStore = createStore<boolean>(false);

// Penseelgrootte (cellen breed × hoog) — gecentreerd op de pointer
export const brushSizeStore = createStore<{ w: number; h: number }>({ w: 1, h: 1 });

// Zak-nummering oriëntatie. 'h' = nummers per kolom, 'v' = nummers per rij
export const zakOrientationStore = createStore<'h' | 'v'>('h');
// Rijnummer voor de volgende zakken-rij die geplaatst wordt. Gebruiker vult zelf in.
export const zakRijNumStore = createStore<number>(1);

// Traylijn-state: welk materiaal er momenteel op TL1 / TL2 draait.
// S-codes (S01..S17) op een zak resolven tegen TL1, T-codes tegen TL2.
// Granulaat-codes resolven autonoom (geen TL-koppeling).
export interface TraylijnState {
  tl1: string;
  tl2: string;
}
const TRAYLIJN_STORAGE_KEY = 'yard_traylijn';
function loadTraylijnInitial(): TraylijnState {
  try {
    const raw = localStorage.getItem(TRAYLIJN_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { tl1: String(p.tl1 || ''), tl2: String(p.tl2 || '') };
    }
  } catch {}
  return { tl1: '', tl2: '' };
}
export const traylijnStore = createStore<TraylijnState>(loadTraylijnInitial());
traylijnStore.subscribe((v) => {
  try { localStorage.setItem(TRAYLIJN_STORAGE_KEY, JSON.stringify(v)); } catch {}
});

// Zak-anchors waar de gebruiker materiaal op wil zetten — opent het
// ZakMaterialPopover. Eén anchor = klik op één zak; meerdere = drag-select
// over meerdere LEGE zakken (gevulde zakken gaan via zakMultiSelectStore).
export interface ZakPickerTarget {
  anchors: Array<{ col: number; row: number }>;
}
export const zakPickerStore = createStore<ZakPickerTarget | null>(null);

// Multi-select op zakken (rubber-band over meerdere anchors). Opent het
// ZakMultiPopover met de optie om de hele groep naar een andere rij te
// verplaatsen.
export interface ZakMultiAnchor {
  col: number;
  row: number;
  zakCode: string;
  zakRij: string;
  zakOrient: 'h' | 'v';
}
export const zakMultiSelectStore = createStore<{ anchors: ZakMultiAnchor[] } | null>(null);

// Configureerbare lijst van zak-codes — gebruikers kunnen via TabCodes
// codes toevoegen/verwijderen en bepalen of ze aan een traylijn gekoppeld
// zijn. Default-set = de eerder hardcoded lijst.
export interface ZakCodeConfig {
  code: string;
  tlLink: 'tl1' | 'tl2' | null;  // null = geen TL-prefix in display-naam
}

const DEFAULT_ZAK_CODES: ZakCodeConfig[] = [
  { code: 'S01', tlLink: 'tl1' },
  { code: 'S02', tlLink: 'tl1' },
  { code: 'S03', tlLink: 'tl1' },
  { code: 'S17', tlLink: 'tl1' },
  { code: 'T01', tlLink: 'tl2' },
  { code: 'T02', tlLink: 'tl2' },
  { code: 'T03', tlLink: 'tl2' },
  { code: 'T17', tlLink: 'tl2' },
  { code: 'S29',  tlLink: null },
  { code: 'S29A', tlLink: null },
  { code: 'Granulaat Mix',     tlLink: null },
  { code: 'Granulaat Naturel', tlLink: null },
];

const ZAK_CODES_STORAGE_KEY = 'yard_zakcodes';
function loadZakCodesInitial(): ZakCodeConfig[] {
  try {
    const raw = localStorage.getItem(ZAK_CODES_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length > 0) {
        return p
          .filter((c: any) => c && typeof c.code === 'string' && c.code.trim().length > 0)
          .map((c: any) => ({
            code: String(c.code).trim(),
            tlLink: c.tlLink === 'tl1' || c.tlLink === 'tl2' ? c.tlLink : null,
          }));
      }
    }
  } catch {}
  return DEFAULT_ZAK_CODES.map((c) => ({ ...c }));
}

export const zakCodesStore = createStore<ZakCodeConfig[]>(loadZakCodesInitial());
zakCodesStore.subscribe((codes) => {
  try { localStorage.setItem(ZAK_CODES_STORAGE_KEY, JSON.stringify(codes)); } catch {}
});
export function resetZakCodesToDefault() {
  zakCodesStore.set(DEFAULT_ZAK_CODES.map((c) => ({ ...c })));
}

// Snel-lookup index — opnieuw opgebouwd bij elke store-update.
let _codeIndex = new Map<string, ZakCodeConfig>(loadZakCodesInitial().map((c) => [c.code, c]));
zakCodesStore.subscribe((codes) => {
  _codeIndex = new Map(codes.map((c) => [c.code, c]));
});

// Resolve een zak-code naar de display-naam op basis van de huidige TL-state
// EN de geconfigureerde tlLink in zakCodesStore. Onbekende codes (custom,
// niet in de store) → as-is.
export function resolveZakLabel(code: string | null | undefined, tl: TraylijnState): string {
  if (!code) return '';
  const cfg = _codeIndex.get(code);
  if (cfg?.tlLink === 'tl1') return tl.tl1 ? `${tl.tl1} ${code}` : code;
  if (cfg?.tlLink === 'tl2') return tl.tl2 ? `${tl.tl2} ${code}` : code;
  return code;
}

// Geeft de TL-materiaalnaam terug die hoort bij een zak-code op het MOMENT
// van plaatsen. Wordt opgeslagen in cell.meta.zakMaterial zodat het label
// niet meeverandert wanneer de gebruiker later een ander materiaal op TL1
// of TL2 zet. Codes zonder TL-koppeling → null.
export function materialForZakCode(code: string | null | undefined, tl: TraylijnState): string | null {
  if (!code) return null;
  const cfg = _codeIndex.get(code);
  if (cfg?.tlLink === 'tl1') return tl.tl1 || null;
  if (cfg?.tlLink === 'tl2') return tl.tl2 || null;
  return null;
}

// Strip de trailing " S" / " T" letter die in de DB-naam zit (bv. "Attewimi S")
// — irrelevant voor display omdat de S/T al uit de code zelf blijkt.
export function stripMaterialTLSuffix(name: string | null | undefined): string {
  if (!name) return '';
  return String(name).replace(/\s+[ST]$/i, '').trim();
}

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
