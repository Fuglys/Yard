// Canvas renderer met Konva — beheert grid achtergrond, cells, areas, selectie.
// 4 layers, alleen die-die-veranderen worden opnieuw getekend.
import Konva from 'konva';
import { colorFor } from './colors';
import { getWallPattern, WALL_TILE_W, WALL_TILE_H } from './patterns';
import type { AreaRow, CellRow } from '../db/dexie';

export const CELL = 24; // pixel grootte per cel — small genoeg om 125x100 te tonen, groot genoeg voor touch
export const GRID_COLS = 200;
export const GRID_ROWS = 190; // 150 + 40 extra rijen onderaan

export interface SelectionRect {
  col1: number; row1: number; col2: number; row2: number;
}

interface RendererOptions {
  container: HTMLDivElement;
  onCellClick?: (col: number, row: number, ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onCellDrag?: (cells: Array<{ col: number; row: number }>) => void;
  onAreaClick?: (areaId: number | string) => void;
  onSelectionMove?: (from: SelectionRect, to: SelectionRect) => void;
  onSelectionResize?: (from: SelectionRect, to: SelectionRect) => void;
  onSelectionChange?: (sel: SelectionRect | null) => void;
  // Rubber-band selectie in overzicht-modus (voor sub-vlak tekenen in bunker-velden)
  onViewSelect?: (rect: SelectionRect) => void;
  // Check of een cel selecteerbaar is in view-mode (alleen bunker-cellen)
  canViewSelect?: (col: number, row: number) => boolean;
  // Wordt aangeroepen wanneer de gebruiker de achtergrond-afbeelding heeft versleept.
  // Krijgt de nieuwe linkerboven-positie in canvas-coordinaten.
  onBackgroundMoved?: (x: number, y: number, autoCentered: boolean) => void;
}

export class YardRenderer {
  stage: Konva.Stage;
  bgImageLayer: Konva.Layer;     // achtergrond-afbeelding (onder grid, alleen edit-mode)
  bgLayer: Konva.Layer;
  cellLayer: Konva.Layer;
  labelLayer: Konva.Layer;
  uiLayer: Konva.Layer;

  // Achtergrond-afbeelding state
  private bgImage: Konva.Image | null = null;
  private bgImageEl: HTMLImageElement | null = null;
  private bgImageVisible = false;
  private bgImageInitialized = false;
  private bgImageDraggable = false;
  private bgImageNaturalW = 0;
  private bgImageNaturalH = 0;
  private bgImageOpacity = 0.7;
  private bgImageScale = 1;

  private container: HTMLDivElement;
  private opts: RendererOptions;
  private cellShapes = new Map<string, Konva.Rect>();
  private cellLabels = new Map<string, Konva.Text>();
  private areaLabels = new Map<number | string, Konva.Text>();
  private areaOutlines = new Map<number | string, Konva.Group>();
  // Per-zak (anchor) outline-lijnen; alleen de zijden die niet tegen een
  // buur in dezelfde area aanliggen worden getekend.
  private zakEdges = new Map<string, Konva.Group>();
  private selectionRect: Konva.Rect;
  private hoverRect: Konva.Rect;
  private pendingGroup!: Konva.Group;
  private subSelectionGroup!: Konva.Group;
  private showGridNumbers = false;
  private editMode = false;

  // Pan/zoom state
  scale = 1;
  panX = 0;
  panY = 0;

  // Drag state
  private isPanning = false;
  private isPainting = false;
  private isSelecting = false;
  private lastPointerPos: { x: number; y: number } | null = null;
  private paintedCells = new Set<string>();
  private selectionStart: { col: number; row: number } | null = null;

  // Paint stroke tracking — voor line-fill + axis lock
  private paintStart: { col: number; row: number } | null = null;
  private paintLast: { col: number; row: number } | null = null;
  // Shift-lock: anchor + as worden ge-(re)set bij iedere shift on→off transitie
  private shiftActive = false;
  private shiftAnchor: { col: number; row: number } | null = null;
  private shiftAxis: 'h' | 'v' | null = null;

  paintMode: 'none' | 'paint' | 'select' = 'none';

  // Selectie state
  private selection: SelectionRect | null = null;
  private selectionGroup: Konva.Group | null = null;
  private resizing: { handle: 'nw' | 'ne' | 'sw' | 'se'; startRect: SelectionRect; startCell: { col: number; row: number } } | null = null;
  private moving: { startRect: SelectionRect; startCell: { col: number; row: number } } | null = null;
  // Toggle vanuit UI (tablet) — desktop kan ook gewoon Shift gebruiken
  lockAxis = false;
  // Penseelgrootte (gecentreerd op de pointer)
  brushW = 1;
  brushH = 1;
  // SnapToGrid: voor zak (2×2) en zak-num (2×1 of 1×2). Override brush + hover + paint zodat alles consistent is.
  // null = normaal brush-gedrag (gecentreerd op pointer); anders = anker-modus (linksboven van rechthoek).
  snapToGrid: { w: number; h: number } | null = null;
  // Force-pan signaal — actief tijdens middel-muisknop, 2-finger touch, of Spatie
  private forcePan = false;
  private spaceHeld = false;
  private activeTouchCount = 0;
  private kbHandlersAttached = false;

  constructor(opts: RendererOptions) {
    this.opts = opts;
    this.container = opts.container;

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.stage = new Konva.Stage({
      container: this.container,
      width: w,
      height: h,
    });

    // Volgorde van toevoeging = z-stack van onder naar boven.
    // bgImageLayer staat onderop zodat grid + cellen eroverheen blijven tekenen.
    this.bgImageLayer = new Konva.Layer({ listening: false });
    this.bgLayer    = new Konva.Layer({ listening: false });
    this.cellLayer  = new Konva.Layer({ listening: false });
    this.labelLayer = new Konva.Layer({ listening: false });
    this.uiLayer    = new Konva.Layer(); // listening default — selectie-handles moeten klikbaar zijn

    this.stage.add(this.bgImageLayer);
    this.stage.add(this.bgLayer);
    this.stage.add(this.cellLayer);
    this.stage.add(this.labelLayer);
    this.stage.add(this.uiLayer);

    this.selectionRect = new Konva.Rect({
      stroke: '#2e86c1',
      strokeWidth: 2,
      dash: [4, 4],
      fill: 'rgba(46,134,193,0.08)',
      visible: false,
      listening: false,
    });
    this.uiLayer.add(this.selectionRect);

    this.hoverRect = new Konva.Rect({
      width: CELL, height: CELL,
      stroke: '#2e86c1',
      strokeWidth: 1.5,
      fill: 'rgba(46,134,193,0.12)',
      visible: false,
      listening: false,
    });
    this.uiLayer.add(this.hoverRect);

    // Group voor de pending-selectie preview (rubber-band → AreaInspector,
    // nog niet opgeslagen). Wordt elke keer leeggemaakt en opnieuw gevuld
    // wanneer setPendingPreview wordt aangeroepen.
    this.pendingGroup = new Konva.Group({ listening: false });
    this.uiLayer.add(this.pendingGroup);

    // Group voor sub-selectie binnen een bestaande sub-area (cellen zijn al
    // opgeslagen, gebruiker heeft een deel gerubberband voor partial-delete).
    this.subSelectionGroup = new Konva.Group({ listening: false });
    this.uiLayer.add(this.subSelectionGroup);

    this.drawBackground();
    this.attachEvents();
    this.fitToContent([]);
    window.addEventListener('resize', () => this.handleResize());
  }

  destroy() {
    window.removeEventListener('resize', this.handleResize);
    if ((this as any).__kbCleanup) (this as any).__kbCleanup();
    this.stage.destroy();
  }

  // ── Background grid ───────────────────────────────────────────────
  private drawBackground() {
    this.bgLayer.destroyChildren();
    const totalW = GRID_COLS * CELL;
    const totalH = GRID_ROWS * CELL;

    // Lichte achtergrondvulling die het grid-veld afbakent (handig in edit-mode).
    // Skip wanneer de achtergrond-afbeelding zichtbaar is — anders dekt de fill
    // de image volledig af.
    const bgImageActive = this.editMode && this.bgImageVisible && !!this.bgImage;
    if (this.editMode && !bgImageActive) {
      this.bgLayer.add(new Konva.Rect({
        x: 0, y: 0, width: totalW, height: totalH,
        fill: '#fafbfc',
        listening: false,
      }));
    }

    // Gridlijnen alleen in edit-mode — in overzicht is een leeg raster storend
    if (this.editMode && this.scale > 0.15) {
      const minorAlpha = 0.20;
      const majorAlpha = 0.45;
      const minorWidth = 1 / this.scale;
      const majorWidth = 1.8 / this.scale;

      // Verticale lijnen
      for (let c = 0; c <= GRID_COLS; c++) {
        const isMajor = c % 5 === 0;
        this.bgLayer.add(new Konva.Line({
          points: [c * CELL, 0, c * CELL, totalH],
          stroke: `rgba(20,30,50,${isMajor ? majorAlpha : minorAlpha})`,
          strokeWidth: isMajor ? majorWidth : minorWidth,
          listening: false,
          perfectDrawEnabled: false,
        }));
      }
      // Horizontale lijnen
      for (let r = 0; r <= GRID_ROWS; r++) {
        const isMajor = r % 5 === 0;
        this.bgLayer.add(new Konva.Line({
          points: [0, r * CELL, totalW, r * CELL],
          stroke: `rgba(20,30,50,${isMajor ? majorAlpha : minorAlpha})`,
          strokeWidth: isMajor ? majorWidth : minorWidth,
          listening: false,
          perfectDrawEnabled: false,
        }));
      }
    }

    // Kolom/rij nummers — automatisch aan in edit-mode bij voldoende zoom
    const showNums = (this.showGridNumbers || this.editMode) && this.scale > 0.4;
    if (showNums) {
      const fontSize = Math.max(8, Math.min(11, 11 / this.scale));
      const labelEvery = this.scale > 1 ? 1 : (this.scale > 0.6 ? 5 : 10);
      for (let c = 0; c < GRID_COLS; c += labelEvery) {
        this.bgLayer.add(new Konva.Text({
          x: c * CELL + 2, y: -CELL * 0.9,
          text: String(c), fontSize,
          fontStyle: 'bold',
          fill: 'rgba(20,30,50,0.55)', listening: false,
        }));
      }
      for (let r = 0; r < GRID_ROWS; r += labelEvery) {
        this.bgLayer.add(new Konva.Text({
          x: -CELL * 1.1, y: r * CELL + 2,
          text: String(r), fontSize,
          fontStyle: 'bold',
          fill: 'rgba(20,30,50,0.55)', listening: false,
        }));
      }
    }
    this.bgLayer.batchDraw();
  }

  // Render een visuele preview van een rubber-band-selectie die nog NIET is
  // opgeslagen. Tekent één semi-transparante witte overlay per geselecteerde
  // cel, plus een dashed wit kader om het hele selectie-cluster — duidelijk
  // visueel onderscheid van een echte (opgeslagen) sub-area.
  setPendingPreview(
    cells: Array<{ col: number; row: number }> | null
  ): void {
    this.pendingGroup.destroyChildren();
    if (!cells || cells.length === 0) {
      this.pendingGroup.visible(false);
      this.uiLayer.batchDraw();
      return;
    }
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const c of cells) {
      // Per-cel semi-transparante witte overlay — IETS overlap (CELL+0.6) zodat
      // er geen subpixel-naden tussen aanliggende cellen zichtbaar zijn.
      this.pendingGroup.add(new Konva.Rect({
        x: c.col * CELL,
        y: c.row * CELL,
        width: CELL + 0.6,
        height: CELL + 0.6,
        fill: 'rgba(255,255,255,0.35)',
        listening: false,
        perfectDrawEnabled: false,
      }));
      if (c.col < minC) minC = c.col;
      if (c.col > maxC) maxC = c.col;
      if (c.row < minR) minR = c.row;
      if (c.row > maxR) maxR = c.row;
    }
    // Dashed outline rond bounding box
    this.pendingGroup.add(new Konva.Rect({
      x: minC * CELL,
      y: minR * CELL,
      width: (maxC - minC + 1) * CELL,
      height: (maxR - minR + 1) * CELL,
      stroke: '#ffffff',
      strokeWidth: 2,
      dash: [8, 6],
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 4,
      shadowOpacity: 0.8,
      listening: false,
      perfectDrawEnabled: false,
    }));
    this.pendingGroup.visible(true);
    this.uiLayer.batchDraw();
  }

  // Sub-selectie binnen een bestaande sub-area: cellen die door de gebruiker
  // zijn gerubberband ter voorbereiding op partial-delete. Visueel: per-cel
  // donker-rode overlay + solide rode dashed outline rond de bounding box —
  // duidelijk verschil met de "pending preview" (witte/transparant).
  setSubSelectionPreview(
    cells: Array<{ col: number; row: number }> | null
  ): void {
    this.subSelectionGroup.destroyChildren();
    if (!cells || cells.length === 0) {
      this.subSelectionGroup.visible(false);
      this.uiLayer.batchDraw();
      return;
    }
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const c of cells) {
      this.subSelectionGroup.add(new Konva.Rect({
        x: c.col * CELL,
        y: c.row * CELL,
        width: CELL + 0.6,
        height: CELL + 0.6,
        fill: 'rgba(231,76,60,0.32)',
        listening: false,
        perfectDrawEnabled: false,
      }));
      if (c.col < minC) minC = c.col;
      if (c.col > maxC) maxC = c.col;
      if (c.row < minR) minR = c.row;
      if (c.row > maxR) maxR = c.row;
    }
    this.subSelectionGroup.add(new Konva.Rect({
      x: minC * CELL,
      y: minR * CELL,
      width: (maxC - minC + 1) * CELL,
      height: (maxR - minR + 1) * CELL,
      stroke: '#c0392b',
      strokeWidth: 2,
      dash: [6, 4],
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 3,
      shadowOpacity: 0.7,
      listening: false,
      perfectDrawEnabled: false,
    }));
    this.subSelectionGroup.visible(true);
    this.uiLayer.batchDraw();
  }

  setShowGridNumbers(v: boolean) {
    this.showGridNumbers = v;
    this.drawBackground();
  }

  setEditMode(v: boolean) {
    if (this.editMode === v) return;
    this.editMode = v;
    this.drawBackground();
    this.applyBgImageVisibility();
  }

  // ── Achtergrond-afbeelding ────────────────────────────────────────
  /**
   * Lazy-load de achtergrond-afbeelding op het canvas. Mag meerdere keren
   * aangeroepen worden — alleen eerste keer doet het netwerk-werk.
   */
  loadBackgroundImage(src: string) {
    if (this.bgImage || this.bgImageEl) return; // al geladen / bezig
    const img = new Image();
    img.onload = () => {
      this.bgImageEl = img;
      this.bgImageNaturalW = img.naturalWidth || img.width;
      this.bgImageNaturalH = img.naturalHeight || img.height;
      const sw = this.bgImageNaturalW * this.bgImageScale;
      const sh = this.bgImageNaturalH * this.bgImageScale;
      this.bgImage = new Konva.Image({
        x: 0, y: 0,
        image: img,
        width: sw,
        height: sh,
        opacity: this.bgImageOpacity,
        listening: false,
        draggable: false,
        perfectDrawEnabled: false,
      });
      // Drag-callback: schrijft positie terug naar de store via opts.
      this.bgImage.on('dragend', () => {
        if (!this.bgImage) return;
        this.opts.onBackgroundMoved?.(this.bgImage.x(), this.bgImage.y(), false);
      });
      this.bgImageLayer.add(this.bgImage);

      // Eerste keer: centreer in het grid en sein dat aan de store door.
      if (!this.bgImageInitialized) {
        const cx = (GRID_COLS * CELL - sw) / 2;
        const cy = (GRID_ROWS * CELL - sh) / 2;
        this.bgImage.position({ x: cx, y: cy });
        this.bgImageInitialized = true;
        this.opts.onBackgroundMoved?.(cx, cy, true);
      }
      // Pas eventueel al gevraagde draggable-state toe nu de image bestaat
      if (this.bgImageDraggable) {
        this.bgImage.draggable(true);
        this.bgImage.listening(true);
        this.bgImageLayer.listening(true);
      }
      this.applyBgImageVisibility();
      // Witte fill kan onnodig zijn nu er een image is — drawBackground opnieuw
      this.drawBackground();
      this.bgImageLayer.batchDraw();
    };
    img.onerror = () => {
      console.warn('YardRenderer: kon achtergrond-afbeelding niet laden:', src);
    };
    img.src = src;
  }

  /** Wordt door de component gezet wanneer de gebruiker een opgeslagen positie heeft. */
  setBackgroundImagePosition(x: number, y: number) {
    if (!this.bgImage) return;
    this.bgImage.position({ x, y });
    this.bgImageInitialized = true;
    this.bgImageLayer.batchDraw();
  }

  setBackgroundImageVisible(v: boolean) {
    if (this.bgImageVisible === v) return;
    this.bgImageVisible = v;
    this.applyBgImageVisibility();
    // Witte fill van bgLayer moet weg/terug afhankelijk van bg-image-zichtbaarheid
    this.drawBackground();
  }

  setBackgroundImageOpacity(o: number) {
    this.bgImageOpacity = o;
    if (this.bgImage) {
      this.bgImage.opacity(o);
      this.bgImageLayer.batchDraw();
    }
  }

  /**
   * Activeer/deactiveer drag-mode op de achtergrond. Wanneer aan, vangt de image
   * pointer-events op zodat de gebruiker kan slepen — anders blijft 'ie passief.
   */
  setBackgroundDraggable(v: boolean) {
    this.bgImageDraggable = v;
    if (this.bgImage) {
      this.bgImage.draggable(v);
      this.bgImage.listening(v);
    }
    // Layer-listening bepaalt of het hele layer-niveau pointer-events vangt.
    this.bgImageLayer.listening(v);
    this.bgImageLayer.batchDraw();
  }

  /** Centreert de afbeelding terug naar het midden van het grid. */
  centerBackgroundImage(): { x: number; y: number } | null {
    if (!this.bgImage || !this.bgImageNaturalW) return null;
    const w = this.bgImage.width();
    const h = this.bgImage.height();
    const cx = (GRID_COLS * CELL - w) / 2;
    const cy = (GRID_ROWS * CELL - h) / 2;
    this.bgImage.position({ x: cx, y: cy });
    this.bgImageLayer.batchDraw();
    return { x: cx, y: cy };
  }

  /**
   * Schalen om het MIDDEN van de afbeelding (zo blijft het beeld ongeveer
   * op zijn plek tijdens schalen). Roept onBackgroundMoved zelf aan zodat de
   * store synchroon blijft met de nieuwe (top-left) positie.
   * `silent=true` skipt de callback — handig bij initialise vanaf een opgeslagen
   * scale waarbij de store al kloppende x/y heeft.
   */
  setBackgroundImageScale(s: number, silent = false) {
    const clamped = Math.max(0.1, Math.min(5, s));
    if (!this.bgImage || this.bgImageNaturalW <= 0) {
      this.bgImageScale = clamped;
      return;
    }
    if (clamped === this.bgImageScale) return;
    const oldW = this.bgImage.width();
    const oldH = this.bgImage.height();
    const newW = this.bgImageNaturalW * clamped;
    const newH = this.bgImageNaturalH * clamped;
    const cx = this.bgImage.x() + oldW / 2;
    const cy = this.bgImage.y() + oldH / 2;
    const newX = cx - newW / 2;
    const newY = cy - newH / 2;
    this.bgImage.width(newW);
    this.bgImage.height(newH);
    this.bgImage.position({ x: newX, y: newY });
    this.bgImageScale = clamped;
    this.bgImageLayer.batchDraw();
    if (!silent) this.opts.onBackgroundMoved?.(newX, newY, false);
  }

  /** Verschuif de afbeelding met (dx, dy) pixels in canvas-coordinaten. */
  nudgeBackgroundImage(dx: number, dy: number): { x: number; y: number } | null {
    if (!this.bgImage) return null;
    const newX = this.bgImage.x() + dx;
    const newY = this.bgImage.y() + dy;
    this.bgImage.position({ x: newX, y: newY });
    this.bgImageLayer.batchDraw();
    return { x: newX, y: newY };
  }

  /** Lees de huidige top-left positie. */
  getBackgroundImagePosition(): { x: number; y: number } | null {
    if (!this.bgImage) return null;
    return { x: this.bgImage.x(), y: this.bgImage.y() };
  }

  /**
   * Bepaalt of de afbeelding zichtbaar is op basis van editMode + visible-flag.
   * Buiten edit-mode is de image ALTIJD verborgen, ongeacht de toggle.
   */
  private applyBgImageVisibility() {
    if (!this.bgImage) return;
    const shouldShow = this.editMode && this.bgImageVisible;
    this.bgImage.visible(shouldShow);
    // Als image niet zichtbaar is heeft draggable geen zin
    if (!shouldShow && this.bgImageDraggable) {
      this.bgImage.draggable(false);
      this.bgImage.listening(false);
      this.bgImageLayer.listening(false);
    }
    this.bgImageLayer.batchDraw();
  }

  // ── Selectie ──────────────────────────────────────────────────────
  setSelection(sel: SelectionRect | null) {
    this.selection = sel ? this.normalizeRect(sel) : null;
    this.renderSelection();
    this.opts.onSelectionChange?.(this.selection);
  }
  getSelection(): SelectionRect | null { return this.selection ? { ...this.selection } : null; }
  clearSelection() { this.setSelection(null); }

  private normalizeRect(r: SelectionRect): SelectionRect {
    const col1 = Math.max(0, Math.min(GRID_COLS - 1, Math.min(r.col1, r.col2)));
    const col2 = Math.max(0, Math.min(GRID_COLS - 1, Math.max(r.col1, r.col2)));
    const row1 = Math.max(0, Math.min(GRID_ROWS - 1, Math.min(r.row1, r.row2)));
    const row2 = Math.max(0, Math.min(GRID_ROWS - 1, Math.max(r.row1, r.row2)));
    return { col1, row1, col2, row2 };
  }

  private renderSelection() {
    if (this.selectionGroup) { this.selectionGroup.destroy(); this.selectionGroup = null; }
    if (!this.selection) { this.uiLayer.batchDraw(); return; }

    const sel = this.selection;
    const x1 = sel.col1 * CELL;
    const y1 = sel.row1 * CELL;
    const x2 = (sel.col2 + 1) * CELL;
    const y2 = (sel.row2 + 1) * CELL;
    const w = x2 - x1;
    const h = y2 - y1;
    const s = this.scale;

    const grp = new Konva.Group();

    // Outline + lichte vulling
    grp.add(new Konva.Rect({
      x: x1, y: y1, width: w, height: h,
      stroke: '#2e86c1', strokeWidth: 2 / s,
      dash: [10 / s, 5 / s],
      fill: 'rgba(46,134,193,0.10)',
      listening: false,
    }));

    // Hoek-handles (4 stuks)
    const hSize = 14 / s;
    const corners: Array<{ name: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; cursor: string }> = [
      { name: 'nw', x: x1, y: y1, cursor: 'nwse-resize' },
      { name: 'ne', x: x2, y: y1, cursor: 'nesw-resize' },
      { name: 'sw', x: x1, y: y2, cursor: 'nesw-resize' },
      { name: 'se', x: x2, y: y2, cursor: 'nwse-resize' },
    ];
    for (const c of corners) {
      const dot = new Konva.Circle({
        x: c.x, y: c.y,
        radius: hSize / 2,
        fill: '#fff', stroke: '#2e86c1', strokeWidth: 2 / s,
        shadowColor: 'rgba(0,0,0,0.25)', shadowBlur: 4 / s, shadowOpacity: 0.6,
        listening: true,
      });
      dot.setAttr('selHandle', c.name);
      dot.setAttr('cursor', c.cursor);
      dot.on('mouseenter', () => { this.container.style.cursor = c.cursor; });
      dot.on('mouseleave', () => { this.container.style.cursor = ''; });
      grp.add(dot);
    }

    // Centrum-handle (kruisje voor verplaatsen)
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const crossOuter = 22 / s;
    const crossArm = 12 / s;
    const moveCircle = new Konva.Circle({
      x: cx, y: cy, radius: crossOuter / 2,
      fill: '#fff', stroke: '#2e86c1', strokeWidth: 2 / s,
      shadowColor: 'rgba(0,0,0,0.25)', shadowBlur: 5 / s, shadowOpacity: 0.6,
      listening: true,
    });
    moveCircle.setAttr('selMove', true);
    moveCircle.on('mouseenter', () => { this.container.style.cursor = 'move'; });
    moveCircle.on('mouseleave', () => { this.container.style.cursor = ''; });
    grp.add(moveCircle);
    grp.add(new Konva.Line({
      points: [cx - crossArm / 2, cy, cx + crossArm / 2, cy],
      stroke: '#2e86c1', strokeWidth: 2.5 / s, listening: false,
    }));
    grp.add(new Konva.Line({
      points: [cx, cy - crossArm / 2, cx, cy + crossArm / 2],
      stroke: '#2e86c1', strokeWidth: 2.5 / s, listening: false,
    }));

    this.selectionGroup = grp;
    this.uiLayer.add(grp);
    this.uiLayer.batchDraw();
    // Handles moeten klikbaar zijn — dus uiLayer listening aan
    this.uiLayer.listening(true);
  }

  // ── Cell rendering ────────────────────────────────────────────────
  renderCells(cells: Map<string, CellRow>, areas: Map<number | string, AreaRow>) {
    // Compute area-aggregate info: which cells belong to which area, what are the area's edges.
    const areaCells = new Map<number | string, Set<string>>();
    for (const [key, c] of cells) {
      if (c.area_id != null) {
        if (!areaCells.has(c.area_id)) areaCells.set(c.area_id, new Set());
        areaCells.get(c.area_id)!.add(key);
      }
    }

    // Pre-compute zak-group extremes — alleen 1 zak per groep toont nummer-label IN de zak
    const zakExtremes = new Map<string, string>(); // groupKey -> cellKey van extreme
    for (const [key, c] of cells) {
      if (c.cell_type !== 'zak' || !c.meta?.zakAnchor || !c.meta?.zakNum) continue;
      const orient = c.meta?.zakOrient || 'h';
      const groupKey = orient === 'h' ? `h:${c.col}:${c.meta.zakNum}` : `v:${c.row}:${c.meta.zakNum}`;
      const curKey = zakExtremes.get(groupKey);
      if (!curKey) { zakExtremes.set(groupKey, key); continue; }
      const cur = cells.get(curKey)!;
      if (orient === 'h' ? c.row < cur.row : c.col < cur.col) zakExtremes.set(groupKey, key);
    }

    // Verwijder shapes voor cellen die niet meer bestaan
    for (const [key, shape] of this.cellShapes) {
      if (!cells.has(key)) {
        shape.destroy();
        this.cellShapes.delete(key);
        const lbl = this.cellLabels.get(key);
        if (lbl) { lbl.destroy(); this.cellLabels.delete(key); }
      }
    }

    // Update / maak shapes per cel.
    // Speciaal geval: zak-cellen worden gerenderd als ÉÉN rect per anchor
    // (2*CELL x 2*CELL) i.p.v. 4 losse 1x1 rects. Geen seam-artefacten,
    // 4× minder shapes, en de zwarte 2x2-buitenrand zit direct op de fill-rect.
    for (const [key, cell] of cells) {
      // Non-anchor zak-cellen: géén shape. Als er ooit een shape voor
      // deze key bestond (bv. cell was eerder een ander type), opruimen.
      if (cell.cell_type === 'zak' && !cell.meta?.zakAnchor) {
        const stale = this.cellShapes.get(key);
        if (stale) { stale.destroy(); this.cellShapes.delete(key); }
        const lbl = this.cellLabels.get(key);
        if (lbl) { lbl.destroy(); this.cellLabels.delete(key); }
        continue;
      }

      const area = cell.area_id != null ? areas.get(cell.area_id) : undefined;
      const colors = colorFor(
        cell.cell_type,
        cell.label,
        area?.material_name || undefined,
        area?.color || undefined
      );
      const isZakAnchor = cell.cell_type === 'zak' && !!cell.meta?.zakAnchor;
      // Bunker/custom-cellen: rects 0.6 px overlap zodat er geen subpixel-naden
      // tussen aangrenzende cellen zichtbaar zijn (anders zie je een raster
      // door een grote bunker). Voor zakken/walls/container/afval houden we
      // strikte cel-grenzen, want die hebben juist een herkenbare structuur.
      const overlap = (cell.cell_type === 'bunker' || cell.cell_type === 'custom') ? 0.6 : 0;
      const rectW = isZakAnchor ? 2 * CELL : CELL + overlap;
      const rectH = isZakAnchor ? 2 * CELL : CELL + overlap;

      let rect = this.cellShapes.get(key);
      if (!rect) {
        rect = new Konva.Rect({
          x: cell.col * CELL,
          y: cell.row * CELL,
          width: rectW,
          height: rectH,
          // listening: false — geen per-cel hit-graph; clicks gaan via
          // getCellAtPointer (zie click-handler). Dat scheelt enorm bij
          // duizenden cellen.
          listening: false,
          perfectDrawEnabled: false,
          shadowForStrokeEnabled: false,
          transformsEnabled: 'position',
        });
        rect.setAttr('cellKey', key);
        this.cellLayer.add(rect);
        this.cellShapes.set(key, rect);
      } else {
        // Maat kan veranderen als een cel wisselt tussen zak-anchor en niet-zak
        if (rect.width() !== rectW) rect.width(rectW);
        if (rect.height() !== rectH) rect.height(rectH);
      }
      rect.fill(colors.fill);

      // Wall-cellen krijgen een baksteen-patroon i.p.v. platte fill.
      if (cell.cell_type === 'wall') {
        const wx = cell.col * CELL;
        const wy = cell.row * CELL;
        rect.fillPatternImage(getWallPattern());
        rect.fillPatternRepeat('repeat');
        rect.fillPatternOffset({
          x: ((wx % WALL_TILE_W) + WALL_TILE_W) % WALL_TILE_W,
          y: ((wy % WALL_TILE_H) + WALL_TILE_H) % WALL_TILE_H,
        });
        rect.fillPriority('pattern');
      } else if (rect.fillPriority() === 'pattern') {
        rect.fillPriority('color');
      }

      // Borders.
      // Zak-anchor: GEEN per-rect stroke — de 2×2 zou dan ook tussen
      // aaneengesloten zakken in dezelfde rij een lijntje tekenen.
      // We gebruiken in plaats daarvan per-zijde Konva.Lines (zie verderop)
      // die alleen verschijnen waar de zijde aan een andere area grenst.
      if (isZakAnchor) {
        rect.strokeEnabled(false);
        rect.strokeWidth(0);
      } else {
        const sides = computeBorders(cell.col, cell.row, cell.area_id ?? null, areaCells.get(cell.area_id ?? -1));
        if (sides.allEdges) {
          rect.strokeEnabled(true);
          rect.stroke(colors.stroke);
          rect.strokeWidth(this.editMode ? 1 : 0.3);
        } else if (sides.anyEdge) {
          rect.strokeEnabled(this.editMode);
          rect.stroke(colors.stroke);
          rect.strokeWidth(0.3);
        } else {
          rect.strokeEnabled(false);
          rect.strokeWidth(0);
        }
      }

      // Label rendering — drie cases:
      //  1) Zak-anchor met zakNum (auto-num) → label IN de 2×2 zak (alleen extreme van groep)
      //  2) Handmatige zak-num cel met label → label kan over 2 cellen spannen
      //  3) Anders → wis label
      if (cell.cell_type === 'zak' && cell.meta?.zakAnchor && cell.meta?.zakNum) {
        const orient = cell.meta?.zakOrient || 'h';
        const groupKey = orient === 'h' ? `h:${cell.col}:${cell.meta.zakNum}` : `v:${cell.row}:${cell.meta.zakNum}`;
        const isExtreme = zakExtremes.get(groupKey) === key;
        if (isExtreme) {
          let txt = this.cellLabels.get(key);
          if (!txt) {
            txt = new Konva.Text({
              x: cell.col * CELL, y: cell.row * CELL,
              width: 2 * CELL, height: 2 * CELL,
              align: 'center', verticalAlign: 'middle',
              fontSize: 16, fontStyle: 'bold',
              fill: 'rgba(40,55,71,0.85)', listening: false,
            });
            this.labelLayer.add(txt);
            this.cellLabels.set(key, txt);
          } else {
            txt.width(2 * CELL); txt.height(2 * CELL);
            txt.fontSize(16); txt.fill('rgba(40,55,71,0.85)');
          }
          txt.text(String(cell.meta.zakNum));
        } else {
          const txt = this.cellLabels.get(key);
          if (txt) { txt.destroy(); this.cellLabels.delete(key); }
        }
      } else if (cell.cell_type === 'zak-num' && cell.label && !cell.meta?.zakCont) {
        let labelW = CELL, labelH = CELL;
        if (cell.meta?.vertical) {
          const below = cells.get(`${cell.col},${cell.row + 1}`);
          if (below?.cell_type === 'zak-num' && below?.meta?.zakCont) labelH = 2 * CELL;
        } else {
          const right = cells.get(`${cell.col + 1},${cell.row}`);
          if (right?.cell_type === 'zak-num' && right?.meta?.zakCont) labelW = 2 * CELL;
        }
        let txt = this.cellLabels.get(key);
        if (!txt) {
          txt = new Konva.Text({
            x: cell.col * CELL, y: cell.row * CELL,
            width: labelW, height: labelH,
            align: 'center', verticalAlign: 'middle',
            fontSize: 11, fontStyle: 'bold',
            fill: colors.text, listening: false,
          });
          this.labelLayer.add(txt);
          this.cellLabels.set(key, txt);
        } else {
          txt.width(labelW);
          txt.height(labelH);
        }
        txt.text(cell.label);
        txt.fill(colors.text);
      } else {
        const txt = this.cellLabels.get(key);
        if (txt) { txt.destroy(); this.cellLabels.delete(key); }
      }
    }

    // Verwijder area labels voor verwijderde areas
    for (const [aid, lbl] of this.areaLabels) {
      if (!areaCells.has(aid)) { lbl.destroy(); this.areaLabels.delete(aid); }
    }

    // Area labels: standaard centroid, behalve voor zak-rijen — die krijgen
    // het label NET ONDER de onderste cel, in zwarte tekst en wat kleiner
    // zodat aaneengesloten rijen elkaar niet overlappen.
    for (const [aid, keys] of areaCells) {
      const area = areas.get(aid);
      const isZak = area?.area_type === 'zak';

      // Bepaal display-tekst:
      // - Zakken: altijd area.name (bijv. "Rij 1") — materiaal wordt apart getoond
      // - Bunker/custom met materiaal: basisnaam + partijen + datum
      // - Anders: area.name
      let displayName = '';
      if (isZak) {
        displayName = area?.name || '';
      } else if (area?.material_name) {
        const baseName = area.material_name.replace(/\s+[STst]$/, '').trim();
        const qty = area.metadata?.quantity;
        let line1 = qty ? `${baseName} (${qty})` : baseName;
        if (area.metadata?.date) {
          // Format als Nederlandse datum: 28-4-2026
          const d = new Date(area.metadata.date + 'T00:00:00');
          const nlDate = `${d.getDate()}-${d.getMonth()+1}-${d.getFullYear()}`;
          line1 += `\n${nlDate}`;
        }
        displayName = line1;
      } else {
        displayName = area?.name || '';
      }
      if (!area || !displayName) {
        const lbl = this.areaLabels.get(aid);
        if (lbl) { lbl.destroy(); this.areaLabels.delete(aid); }
        continue;
      }

      // Bereken centroid + bounds voor deze area
      let sumC = 0, sumR = 0, n = 0;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const k of keys) {
        const c = cells.get(k);
        if (!c) continue;
        sumC += c.col; sumR += c.row; n++;
        if (c.col < minC) minC = c.col;
        if (c.col > maxC) maxC = c.col;
        if (c.row < minR) minR = c.row;
        if (c.row > maxR) maxR = c.row;
      }
      if (n === 0) continue;

      const isContainerOrAfval = area.area_type === 'container' || area.area_type === 'afval';

      let lbl = this.areaLabels.get(aid);
      if (!lbl) {
        lbl = new Konva.Text({
          align: 'center',
          fontStyle: 'bold',
          listening: false,
        });
        this.labelLayer.add(lbl);
        this.areaLabels.set(aid, lbl);
      }
      lbl.text(displayName);
      lbl.offsetX(0); lbl.offsetY(0);

      if (isZak) {
        lbl.fontStyle('bold');
        // Onder de onderste rij, gehorizontaal-gecentreerd op de zak-rij.
        const fontSize = 11;
        const labelW = (maxC - minC + 1) * CELL;
        const labelX = minC * CELL;
        const labelY = (maxR + 1) * CELL + 2;
        lbl.fontSize(fontSize);
        lbl.fill('#000');
        lbl.strokeEnabled(false);
        lbl.shadowColor('rgba(255,255,255,0.9)');
        lbl.shadowBlur(2);
        lbl.shadowOpacity(1);
        lbl.x(labelX);
        lbl.y(labelY);
        lbl.width(labelW);
      } else if (isContainerOrAfval) {
        // Tekst gecentreerd in het vlak, zo groot mogelijk zonder buiten het veld te komen.
        const areaW = (maxC - minC + 1) * CELL;
        const areaH = (maxR - minR + 1) * CELL;
        const centerX = minC * CELL;
        const centerY = minR * CELL;
        // Schat fontSize: breedte / aantal karakters, maar niet groter dan hoogte
        const textLen = Math.max(1, displayName.length);
        const maxByWidth = (areaW * 1.4) / textLen;
        const maxByHeight = areaH * 0.6;
        const fontSize = Math.max(12, Math.min(maxByWidth, maxByHeight, 60));
        lbl.fontSize(fontSize);
        lbl.fontStyle('900 bold');
        lbl.fill('#fff');
        lbl.strokeEnabled(true);
        lbl.stroke('#000');
        lbl.strokeWidth(Math.max(0.8, fontSize * 0.06));
        lbl.fillAfterStrokeEnabled(true);
        lbl.shadowOpacity(0);
        lbl.shadowBlur(0);
        lbl.x(centerX);
        lbl.y(centerY + (areaH - fontSize) / 2);
        lbl.width(areaW);
        lbl.align('center');
        lbl.verticalAlign('middle');
      } else {
        // Bunker/custom areas: tekst schaalt mee met vlakgrootte, gecentreerd.
        // Geen auto-wrap (wrap: 'none') — anders splits Konva "Augustine (14)"
        // op de spatie wanneer de fontSize-schatting iets te ruim is, en zien
        // we 3 regels i.p.v. 2 die niet meer netjes centreren.
        // Bold karakter-breedte ≈ 0.7 × fontSize voor een veilige schatting.
        const areaW = (maxC - minC + 1) * CELL;
        const areaH = (maxR - minR + 1) * CELL;
        const centerX = minC * CELL;
        const centerY = minR * CELL;
        const lines = displayName.split('\n');
        const longestLine = Math.max(...lines.map((l) => l.length), 1);
        const PAD = 0.92;                       // 8% padding aan elke kant
        const CHAR_W = 0.7;                     // bold-karakter breedte/fontSize ratio
        const LINE_H = 1.15;                    // line-height factor
        const fsByW = (areaW * PAD) / (longestLine * CHAR_W);
        const fsByH = (areaH * PAD) / (lines.length * LINE_H);
        const fontSize = Math.max(9, Math.min(fsByW, fsByH, 80));
        lbl.fontSize(fontSize);
        lbl.fontStyle('900 bold');
        lbl.fill('#fff');
        lbl.strokeEnabled(true);
        lbl.stroke('#000');
        lbl.strokeWidth(Math.max(0.6, fontSize * 0.06));
        lbl.fillAfterStrokeEnabled(true);
        lbl.shadowColor('rgba(0,0,0,0.55)');
        lbl.shadowBlur(Math.max(2, fontSize * 0.08));
        lbl.shadowOpacity(0.7);
        lbl.lineHeight(LINE_H);
        lbl.wrap('none');
        lbl.x(centerX);
        lbl.y(centerY);
        lbl.width(areaW);
        lbl.height(areaH);
        lbl.align('center');
        lbl.verticalAlign('middle');
      }
    }

    // ── Per-zak edges (alleen buiten-zijden van een Rij-groep) ──────
    // Voor elke zak-anchor (col,row) checken we of de cellen NET BUITEN
    // het 2×2 vak ook bij dezelfde area horen. Zo ja → die zijde ligt
    // intern en krijgt geen lijntje. Zo niet → 0.5 px zwart lijntje.
    const seenAnchors = new Set<string>();
    for (const [, cell] of cells) {
      if (cell.cell_type !== 'zak' || !cell.meta?.zakAnchor) continue;
      const k = `${cell.col},${cell.row}`;
      seenAnchors.add(k);

      const aid = cell.area_id;
      const aSet = aid != null ? areaCells.get(aid) : undefined;
      const same = (cc: number, rr: number) => !!aSet?.has(`${cc},${rr}`);
      const c0 = cell.col, r0 = cell.row;
      const topOpen    = !(same(c0,     r0 - 1) && same(c0 + 1, r0 - 1));
      const rightOpen  = !(same(c0 + 2, r0)     && same(c0 + 2, r0 + 1));
      const bottomOpen = !(same(c0,     r0 + 2) && same(c0 + 1, r0 + 2));
      const leftOpen   = !(same(c0 - 1, r0)     && same(c0 - 1, r0 + 1));

      const x0 = c0 * CELL, y0 = r0 * CELL;
      const x1 = x0 + 2 * CELL, y1 = y0 + 2 * CELL;

      let group = this.zakEdges.get(k);
      if (!group) {
        group = new Konva.Group({ listening: false });
        this.uiLayer.add(group);
        this.zakEdges.set(k, group);
      }
      // Hergebruik bestaande Line children waar mogelijk; reset er 4
      const lines = group.getChildren() as unknown as Konva.Line[];
      while (lines.length < 4) {
        const ln = new Konva.Line({
          stroke: '#000', strokeWidth: 0.5,
          listening: false, perfectDrawEnabled: false,
        });
        group.add(ln);
      }
      const setLine = (idx: number, open: boolean, pts: number[]) => {
        const ln = group!.getChildren()[idx] as unknown as Konva.Line;
        if (open) { ln.points(pts); ln.visible(true); }
        else      { ln.visible(false); }
      };
      setLine(0, topOpen,    [x0, y0, x1, y0]); // top
      setLine(1, rightOpen,  [x1, y0, x1, y1]); // right
      setLine(2, bottomOpen, [x0, y1, x1, y1]); // bottom
      setLine(3, leftOpen,   [x0, y0, x0, y1]); // left
    }
    // Opruimen: edges van zakken die niet meer bestaan
    for (const [k, g] of this.zakEdges) {
      if (!seenAnchors.has(k)) {
        g.destroy();
        this.zakEdges.delete(k);
      }
    }

    this.cellLayer.batchDraw();
    this.labelLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  // ── Pan/zoom ──────────────────────────────────────────────────────
  applyTransform() {
    this.stage.scale({ x: this.scale, y: this.scale });
    this.stage.position({ x: this.panX, y: this.panY });
    this.stage.batchDraw();
  }

  zoom(delta: number, centerX?: number, centerY?: number) {
    const oldScale = this.scale;
    const newScale = Math.max(0.15, Math.min(4, oldScale * delta));
    if (newScale === oldScale) return;
    if (centerX != null && centerY != null) {
      // Zoom rond punt
      const mousePointTo = {
        x: (centerX - this.panX) / oldScale,
        y: (centerY - this.panY) / oldScale,
      };
      this.scale = newScale;
      this.panX = centerX - mousePointTo.x * newScale;
      this.panY = centerY - mousePointTo.y * newScale;
    } else {
      this.scale = newScale;
    }
    this.applyTransform();
    this.drawBackground();
  }

  fitToContent(cells: CellRow[] | string[] = []) {
    const w = this.stage.width();
    const h = this.stage.height();
    if (w === 0 || h === 0) {
      // Stage nog niet klaar; opnieuw proberen volgende frame
      requestAnimationFrame(() => this.fitToContent(cells));
      return;
    }
    // Zonder cellen: vul standaard yard area
    const cellsList: { col: number; row: number }[] =
      Array.isArray(cells) && cells.length && typeof cells[0] !== 'string'
        ? (cells as CellRow[]).map((c) => ({ col: c.col, row: c.row }))
        : [];

    let minC = 0, maxC = 100, minR = 0, maxR = 60;
    if (cellsList.length > 0) {
      minC = Infinity; maxC = -Infinity; minR = Infinity; maxR = -Infinity;
      for (const c of cellsList) {
        if (c.col < minC) minC = c.col;
        if (c.col > maxC) maxC = c.col;
        if (c.row < minR) minR = c.row;
        if (c.row > maxR) maxR = c.row;
      }
    }
    const contentW = (maxC - minC + 2) * CELL;
    const contentH = (maxR - minR + 2) * CELL;
    const scaleX = w / contentW;
    const scaleY = h / contentH;
    this.scale = Math.min(scaleX, scaleY) * 0.9;
    this.panX = w / 2 - ((minC + maxC + 1) / 2) * CELL * this.scale;
    this.panY = h / 2 - ((minR + maxR + 1) / 2) * CELL * this.scale;
    this.applyTransform();
    this.drawBackground();
  }

  // ── Events ────────────────────────────────────────────────────────
  handleResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.stage.width(w);
    this.stage.height(h);
    this.drawBackground();
    this.stage.batchDraw();
  };

  // Effectieve brush-grootte: snapToGrid heeft prioriteit boven brushW/H
  private effW(): number { return this.snapToGrid?.w ?? this.brushW; }
  private effH(): number { return this.snapToGrid?.h ?? this.brushH; }

  // Snap een cel naar het anchor-grid van snapToGrid (linksboven van rechthoek). No-op als geen snap.
  private snapCell(c: { col: number; row: number }): { col: number; row: number } {
    if (!this.snapToGrid) return c;
    const w = this.snapToGrid.w, h = this.snapToGrid.h;
    return {
      col: Math.floor(c.col / w) * w,
      row: Math.floor(c.row / h) * h,
    };
  }

  // Expandeer 1 ankerpunt naar alle cellen die de brush bedekt
  // - SnapToGrid mode: anchor = linksboven, expandeer w×h
  // - Normaal mode: anchor = pointer, gecentreerd
  private expandBrush(c: { col: number; row: number }): Array<{ col: number; row: number }> {
    const w = this.effW();
    const h = this.effH();
    if (w <= 1 && h <= 1) return [c];
    const dx = this.snapToGrid ? 0 : -Math.floor((w - 1) / 2);
    const dy = this.snapToGrid ? 0 : -Math.floor((h - 1) / 2);
    const out: Array<{ col: number; row: number }> = [];
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const col = c.col + dx + j;
        const row = c.row + dy + i;
        if (col >= 0 && row >= 0 && col < GRID_COLS && row < GRID_ROWS) {
          out.push({ col, row });
        }
      }
    }
    return out;
  }

  private brushOffsetX(): number {
    if (this.snapToGrid) return 0;
    return -Math.floor((this.brushW - 1) / 2);
  }
  private brushOffsetY(): number {
    if (this.snapToGrid) return 0;
    return -Math.floor((this.brushH - 1) / 2);
  }

  private getCellAtPointer(): { col: number; row: number } | null {
    const pos = this.stage.getRelativePointerPosition();
    if (!pos) return null;
    const col = Math.floor(pos.x / CELL);
    const row = Math.floor(pos.y / CELL);
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return null;
    return { col, row };
  }

  private attachEvents() {
    const stage = this.stage;

    // Voorkom dat browser autoscroll opent op middelste muisknop / contextmenu op rechtermuisknop
    this.container.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.container.addEventListener('contextmenu', (e) => e.preventDefault());
    this.container.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    // Spatie ingedrukt = forceer pan-modus (alleen toetsenbord, dus desktop)
    if (!this.kbHandlersAttached) {
      this.kbHandlersAttached = true;
      const onKeyDown = (e: KeyboardEvent) => {
        // Geen pan-overschrijving als gebruiker in een input typt
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        if (e.code === 'Space' && !this.spaceHeld) {
          this.spaceHeld = true;
          e.preventDefault();
          this.container.style.cursor = 'grab';
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          this.spaceHeld = false;
          this.container.style.cursor = '';
        }
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      // Cleanup bij destroy() doet hetzelfde
      (this as any).__kbCleanup = () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }

    // Wheel zoom
    stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const direction = e.evt.deltaY > 0 ? 0.9 : 1.1;
      const pointer = stage.getPointerPosition();
      this.zoom(direction, pointer?.x, pointer?.y);
    });

    // Pinch zoom + 2-finger pan (touch) — onafhankelijk van paint mode
    let lastDist = 0;
    let lastCenter: { x: number; y: number } | null = null;
    stage.on('touchmove', (e) => {
      e.evt.preventDefault();
      const t1 = e.evt.touches[0];
      const t2 = e.evt.touches[1];
      if (t1 && t2) {
        // Cancel paint stroke definitief bij 2 vingers
        if (this.isPainting) {
          this.isPainting = false;
          this.paintedCells.clear();
          this.paintStart = null;
          this.paintLast = null;
        }
        this.forcePan = true;
        const p1 = { x: t1.clientX, y: t1.clientY };
        const p2 = { x: t2.clientX, y: t2.clientY };
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        if (lastDist > 0) {
          const delta = dist / lastDist;
          // Alleen zoomen als merkbare pinch beweging (anders puur pannen)
          if (Math.abs(delta - 1) > 0.005) {
            this.zoom(delta, center.x, center.y);
          }
          if (lastCenter) {
            this.panX += (center.x - lastCenter.x);
            this.panY += (center.y - lastCenter.y);
            this.applyTransform();
          }
        }
        lastDist = dist;
        lastCenter = center;
      }
    });
    stage.on('touchend', (e) => {
      lastDist = 0;
      lastCenter = null;
      if (e.evt instanceof TouchEvent && e.evt.touches.length === 0) {
        this.forcePan = false;
      }
    });

    // Pointer down
    stage.on('mousedown touchstart', (e) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      this.lastPointerPos = pos;

      // Track touch count
      if (e.evt instanceof TouchEvent) {
        this.activeTouchCount = e.evt.touches.length;
      }

      // ── FORCE PAN: middel-muisknop / spatie / 2 vingers — ongeacht paint-tool ──
      const isMouseEvent = !(e.evt instanceof TouchEvent);
      const isMiddleMouse = isMouseEvent && (e.evt as MouseEvent).button === 1;
      const isMultiTouch = e.evt instanceof TouchEvent && e.evt.touches.length > 1;
      // [DEBUG] log alle mousedown events zodat we kunnen verifiëren of middle-mouse
      // überhaupt aankomt in zak-mode. Verwijder zodra het probleem opgelost is.
      if (isMouseEvent) {
        // eslint-disable-next-line no-console
        console.log('[YardRenderer] mousedown', {
          button: (e.evt as MouseEvent).button,
          isMiddle: isMiddleMouse,
          paintMode: this.paintMode,
          snap: this.snapToGrid,
          spaceHeld: this.spaceHeld,
        });
      }
      if (isMiddleMouse || isMultiTouch || this.spaceHeld) {
        // Cancel eventueel bezig zijnde paint stroke (zonder cellen te wissen)
        if (this.isPainting) {
          this.isPainting = false;
          this.paintedCells.clear();
          this.paintStart = null;
          this.paintLast = null;
          this.shiftActive = false;
          this.shiftAnchor = null;
          this.shiftAxis = null;
        }
        this.forcePan = true;
        this.isPanning = true;
        this.container.style.cursor = 'grabbing';
        return;
      }

      this.paintedCells.clear();

      // Bezig met slepen van achtergrond-afbeelding? Dan laat Konva het zelf afhandelen.
      // We willen geen pan starten + geen rubber-band selectie.
      if (this.bgImageDraggable && this.bgImage && (e.target === this.bgImage as any)) {
        return;
      }

      if (this.paintMode === 'paint') {
        this.isPainting = true;
        // Reset alle shift-lock state per nieuwe stroke
        this.shiftActive = false;
        this.shiftAnchor = null;
        this.shiftAxis = null;
        const raw = this.getCellAtPointer();
        if (raw) {
          const cell = this.snapCell(raw);
          this.paintStart = cell;
          this.paintLast = cell;
          // Als shift al ingedrukt is bij mousedown of toggle aan staat — anchor meteen
          const native = (e.evt as any);
          const wantsLock = (native?.shiftKey === true) || this.lockAxis;
          if (wantsLock) {
            this.shiftActive = true;
            this.shiftAnchor = { ...cell };
            this.shiftAxis = null;
          }
          if (this.opts.onCellDrag) {
            const expanded = this.expandBrush(cell);
            const fresh: Array<{ col: number; row: number }> = [];
            for (const c of expanded) {
              const k = `${c.col},${c.row}`;
              if (!this.paintedCells.has(k)) {
                this.paintedCells.add(k);
                fresh.push(c);
              }
            }
            if (fresh.length) this.opts.onCellDrag(fresh);
          }
        }
      } else if (this.paintMode === 'select') {
        // Eerst: klikken op een handle of het centrum-kruisje?
        const t: any = e.target;
        const handleName = t?.getAttr?.('selHandle');
        const isMoveHandle = t?.getAttr?.('selMove');
        const startCell = this.getCellAtPointer();

        if (handleName && this.selection && startCell) {
          // Resize starten
          this.resizing = {
            handle: handleName,
            startRect: { ...this.selection },
            startCell,
          };
          return;
        }
        if (isMoveHandle && this.selection && startCell) {
          // Move starten
          this.moving = {
            startRect: { ...this.selection },
            startCell,
          };
          this.container.style.cursor = 'grabbing';
          return;
        }

        // Anders: nieuwe rubber-band selectie starten
        this.isSelecting = true;
        this.selectionStart = startCell;
        if (this.selectionStart) {
          // Wis vorige selectie visueel
          this.setSelection(null);
          const x = this.selectionStart.col * CELL;
          const y = this.selectionStart.row * CELL;
          this.selectionRect.position({ x, y }).size({ width: CELL, height: CELL }).visible(true);
          this.uiLayer.batchDraw();
        }
      } else {
        this.isPanning = true;
        // In view-mode (paintMode === 'none'): start rubber-band selectie
        // alleen als de startcel selecteerbaar is (bunker-cel).
        if (this.paintMode === 'none') {
          const startCell = this.getCellAtPointer();
          if (startCell && (!this.opts.canViewSelect || this.opts.canViewSelect(startCell.col, startCell.row))) {
            this.isSelecting = true;
            this.selectionStart = startCell;
            const x = startCell.col * CELL;
            const y = startCell.row * CELL;
            this.selectionRect.position({ x, y }).size({ width: CELL, height: CELL }).visible(true);
            this.uiLayer.batchDraw();
            // Niet pannen als we selecteren
            this.isPanning = false;
          }
        }
      }
    });

    // Pointer move
    stage.on('mousemove touchmove', (e) => {
      // Skip alle paint/select handling op touch met 2+ vingers — dedicated touchmove handler doet pan/zoom
      if (e.evt instanceof TouchEvent && e.evt.touches.length >= 2) {
        return;
      }
      const pos = stage.getPointerPosition();
      if (!pos) return;

      // Hover cel highlight (alleen mouse, geen touch). Snap naar zak-anchor wanneer snapToGrid actief.
      if (this.paintMode === 'paint' && !this.isPainting && e.evt instanceof MouseEvent) {
        const raw = this.getCellAtPointer();
        if (raw) {
          const cell = this.snapCell(raw);
          this.hoverRect.position({
            x: (cell.col + this.brushOffsetX()) * CELL,
            y: (cell.row + this.brushOffsetY()) * CELL,
          }).size({
            width: this.effW() * CELL,
            height: this.effH() * CELL,
          }).visible(true);
          this.uiLayer.batchDraw();
        }
      } else {
        this.hoverRect.visible(false);
      }

      if (this.isPanning && this.lastPointerPos) {
        this.panX += pos.x - this.lastPointerPos.x;
        this.panY += pos.y - this.lastPointerPos.y;
        this.lastPointerPos = pos;
        this.applyTransform();
      } else if (this.isPainting && this.opts.onCellDrag) {
        const raw = this.getCellAtPointer();
        if (!raw || !this.paintLast) return;
        const cell = this.snapCell(raw);

        const native = (e.evt as any);
        const wantsLock = (native?.shiftKey === true) || this.lockAxis;

        // ── Detecteer transitie van shift-state ─────────────────────
        if (wantsLock !== this.shiftActive) {
          this.shiftActive = wantsLock;
          if (wantsLock) {
            // Net ingedrukt — anchor op huidige paintLast (waar de stroke nu is)
            this.shiftAnchor = { ...this.paintLast };
            this.shiftAxis = null;
          } else {
            // Losgelaten — geen lock meer
            this.shiftAnchor = null;
            this.shiftAxis = null;
          }
        }

        let target = cell;
        let lineFrom = this.paintLast;

        if (wantsLock && this.shiftAnchor) {
          // Bepaal as zodra de pointer afwijkt van de anchor
          if (this.shiftAxis === null) {
            const dx = Math.abs(cell.col - this.shiftAnchor.col);
            const dy = Math.abs(cell.row - this.shiftAnchor.row);
            if (dx > 0 || dy > 0) {
              this.shiftAxis = dx >= dy ? 'h' : 'v';
            }
          }
          if (this.shiftAxis === 'h') {
            target = { col: cell.col, row: this.shiftAnchor.row };
            // Snap óók de bron-positie naar de as zodat Bresenham nooit door buurcellen kan
            lineFrom = { col: this.paintLast.col, row: this.shiftAnchor.row };
          } else if (this.shiftAxis === 'v') {
            target = { col: this.shiftAnchor.col, row: cell.row };
            lineFrom = { col: this.shiftAnchor.col, row: this.paintLast.row };
          }
        }

        // Bresenham-lijn — vult tussenliggende cellen die door snelle drag overgeslagen kunnen zijn
        let path = bresenhamLine(lineFrom.col, lineFrom.row, target.col, target.row);

        // Safety belt: filter alles dat onverhoopt buiten de as zou kunnen vallen
        if (wantsLock && this.shiftAxis && this.shiftAnchor) {
          const anchor = this.shiftAnchor;
          if (this.shiftAxis === 'h') path = path.filter((p) => p.row === anchor.row);
          else                       path = path.filter((p) => p.col === anchor.col);
        }

        // Brush expansion: voor elke cel in pad, expand naar brush-rechthoek
        const fresh: Array<{ col: number; row: number }> = [];
        for (const c of path) {
          const expanded = this.expandBrush(c);
          for (const e of expanded) {
            const k = `${e.col},${e.row}`;
            if (!this.paintedCells.has(k)) {
              this.paintedCells.add(k);
              fresh.push(e);
            }
          }
        }
        if (fresh.length) this.opts.onCellDrag(fresh);
        this.paintLast = target;

        // Visuele preview: highlight de hele brush-rechthoek
        this.hoverRect.position({
          x: (target.col + this.brushOffsetX()) * CELL,
          y: (target.row + this.brushOffsetY()) * CELL,
        }).size({
          width: this.effW() * CELL,
          height: this.effH() * CELL,
        }).visible(true);
        this.uiLayer.batchDraw();
      } else if (this.isSelecting && this.selectionStart) {
        const cell = this.getCellAtPointer();
        if (cell) {
          const x1 = Math.min(this.selectionStart.col, cell.col) * CELL;
          const y1 = Math.min(this.selectionStart.row, cell.row) * CELL;
          const x2 = (Math.max(this.selectionStart.col, cell.col) + 1) * CELL;
          const y2 = (Math.max(this.selectionStart.row, cell.row) + 1) * CELL;
          this.selectionRect.position({ x: x1, y: y1 }).size({ width: x2 - x1, height: y2 - y1 });
          this.uiLayer.batchDraw();
        }
      } else if (this.resizing) {
        const cur = this.getCellAtPointer();
        if (!cur) return;
        const sr = this.resizing.startRect;
        const dx = cur.col - this.resizing.startCell.col;
        const dy = cur.row - this.resizing.startCell.row;
        let nc1 = sr.col1, nr1 = sr.row1, nc2 = sr.col2, nr2 = sr.row2;
        switch (this.resizing.handle) {
          case 'nw': nc1 = sr.col1 + dx; nr1 = sr.row1 + dy; break;
          case 'ne': nc2 = sr.col2 + dx; nr1 = sr.row1 + dy; break;
          case 'sw': nc1 = sr.col1 + dx; nr2 = sr.row2 + dy; break;
          case 'se': nc2 = sr.col2 + dx; nr2 = sr.row2 + dy; break;
        }

        // Shift = proportioneel (aspect-ratio behouden)
        const shift = (e.evt as any)?.shiftKey === true;
        if (shift) {
          const origW = sr.col2 - sr.col1 + 1;
          const origH = sr.row2 - sr.row1 + 1;
          const ratio = origW / origH;
          // Bepaal welke as leidend is op basis van schaal-factor
          const newW = Math.abs(nc2 - nc1) + 1;
          const newH = Math.abs(nr2 - nr1) + 1;
          const scaleW = newW / origW;
          const scaleH = newH / origH;
          let targetW: number, targetH: number;
          if (Math.abs(scaleW) >= Math.abs(scaleH)) {
            targetW = newW;
            targetH = Math.max(1, Math.round(newW / ratio));
          } else {
            targetH = newH;
            targetW = Math.max(1, Math.round(newH * ratio));
          }
          // Anker tegenovergesteld van handle
          switch (this.resizing.handle) {
            case 'nw': nc1 = sr.col2 - targetW + 1; nr1 = sr.row2 - targetH + 1; break;
            case 'ne': nc2 = sr.col1 + targetW - 1; nr1 = sr.row2 - targetH + 1; break;
            case 'sw': nc1 = sr.col2 - targetW + 1; nr2 = sr.row1 + targetH - 1; break;
            case 'se': nc2 = sr.col1 + targetW - 1; nr2 = sr.row1 + targetH - 1; break;
          }
        }

        this.selection = this.normalizeRect({ col1: nc1, row1: nr1, col2: nc2, row2: nr2 });
        this.renderSelection();
      } else if (this.moving) {
        const cur = this.getCellAtPointer();
        if (!cur) return;
        const dx = cur.col - this.moving.startCell.col;
        const dy = cur.row - this.moving.startCell.row;
        const sr = this.moving.startRect;
        this.selection = this.normalizeRect({
          col1: sr.col1 + dx, row1: sr.row1 + dy,
          col2: sr.col2 + dx, row2: sr.row2 + dy,
        });
        this.renderSelection();
      }
    });

    // Pointer up
    stage.on('mouseup touchend mouseleave', (e) => {
      // Update touch count
      if (e.evt instanceof TouchEvent) {
        this.activeTouchCount = e.evt.touches.length;
      }

      // Force-pan einde — alleen als alle relevante triggers losgelaten zijn
      if (this.forcePan) {
        const isMouseEvent = !(e.evt instanceof TouchEvent);
        const isMiddleUp = isMouseEvent && (e.evt as MouseEvent).button === 1;
        const allTouchesUp = e.evt instanceof TouchEvent && e.evt.touches.length === 0;
        if (isMiddleUp || allTouchesUp || (isMouseEvent && (e.type === 'mouseleave' || e.type === 'mouseup'))) {
          this.forcePan = false;
          this.container.style.cursor = this.spaceHeld ? 'grab' : '';
        }
      }

      if (this.isPainting) {
        this.isPainting = false;
        this.paintedCells.clear();
        this.paintStart = null;
        this.paintLast = null;
        this.shiftActive = false;
        this.shiftAnchor = null;
        this.shiftAxis = null;
      }
      // ── Resize commit ──
      if (this.resizing) {
        const from = this.resizing.startRect;
        const to = this.selection!;
        if (from.col1 !== to.col1 || from.row1 !== to.row1 || from.col2 !== to.col2 || from.row2 !== to.row2) {
          this.opts.onSelectionResize?.(from, to);
        }
        this.resizing = null;
        this.container.style.cursor = '';
        this.renderSelection();
      }

      // ── Move commit ──
      if (this.moving) {
        const from = this.moving.startRect;
        const to = this.selection!;
        if (from.col1 !== to.col1 || from.row1 !== to.row1) {
          this.opts.onSelectionMove?.(from, to);
        }
        this.moving = null;
        this.container.style.cursor = '';
        this.renderSelection();
      }

      // ── Rubber-band selectie afronden ──
      if (this.isSelecting && this.selectionStart) {
        const end = this.getCellAtPointer() || this.selectionStart;
        const rect: SelectionRect = this.normalizeRect({
          col1: this.selectionStart.col, row1: this.selectionStart.row,
          col2: end.col, row2: end.row,
        });
        this.isSelecting = false;
        this.selectionStart = null;
        this.selectionRect.visible(false);
        this.uiLayer.batchDraw();

        if (this.paintMode === 'select') {
          // Activate selectie met handles
          this.setSelection(rect);
        } else if (this.paintMode === 'none' && this.opts.onViewSelect) {
          // View-mode rubber-band: stuur naar onViewSelect als het meer dan 1 cel is
          const w = rect.col2 - rect.col1 + 1;
          const h = rect.row2 - rect.row1 + 1;
          if (w > 1 || h > 1) {
            (this as any).__viewSelectTime = Date.now();
            this.opts.onViewSelect(rect);
          }
        } else {
          // Legacy: bulk-paint via select (achteraf alle cellen sturen)
          const cells: Array<{ col: number; row: number }> = [];
          for (let r = rect.row1; r <= rect.row2; r++)
            for (let c = rect.col1; c <= rect.col2; c++)
              cells.push({ col: c, row: r });
          if (this.opts.onCellDrag) this.opts.onCellDrag(cells);
        }
      }
      this.isPanning = false;
      this.lastPointerPos = null;
    });

    // Click — voor area inspector. Cell-rects zijn listening:false (perf),
    // dus we lezen de cel onder de pointer rechtstreeks van de stage.
    // Bij een korte klik (geen drag) → onCellClick.
    // Bij een sleep in view-mode → rubber-band selectie → onViewSelect.
    stage.on('click tap', (e) => {
      if (this.paintMode !== 'none') return;
      // Blokkeer click als er net een viewSelect was (binnen 500ms)
      const vst = (this as any).__viewSelectTime || 0;
      if (Date.now() - vst < 500) return;
      const cell = this.getCellAtPointer();
      if (cell && this.opts.onCellClick) {
        this.opts.onCellClick(cell.col, cell.row, e);
      }
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<{ col: number; row: number }> {
  const points: Array<{ col: number; row: number }> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (true) {
    points.push({ col: x, row: y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
  return points;
}

function computeBorders(col: number, row: number, areaId: number | string | null, areaCells?: Set<string>) {
  if (!areaId || !areaCells) return { allEdges: true, anyEdge: true, top: true, right: true, bottom: true, left: true };
  const top    = !areaCells.has(`${col},${row - 1}`);
  const right  = !areaCells.has(`${col + 1},${row}`);
  const bottom = !areaCells.has(`${col},${row + 1}`);
  const left   = !areaCells.has(`${col - 1},${row}`);
  return {
    allEdges: top && right && bottom && left,
    anyEdge: top || right || bottom || left,
    top, right, bottom, left,
  };
}

