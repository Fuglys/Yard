<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { YardRenderer, type SelectionRect } from '../canvas/YardRenderer';
  import { areasStore, cellsStore, upsertArea, upsertCells, deleteCells, deleteArea, nextTempId } from '../stores/state';
  import { paintToolStore, modeStore, inspectorAreaId, pendingSubAreaId, pendingSelectionStore, subSelectionCellsStore, lineLockStore, brushSizeStore, zakOrientationStore, zakRijNumStore, lastPlacedAreaId, backgroundImageStore, zakPickerStore, zakMultiSelectStore, traylijnStore, toast } from '../stores/ui';
  import { schedulePush } from '../sync/engine';
  import { history } from '../stores/history';
  import type { CellRow, AreaRow } from '../db/dexie';

  let container: HTMLDivElement;
  let renderer: YardRenderer | null = null;

  // Status indicator — clean label rewrite
  let activeToolLabel = $state('Geen tool — sleep om te pannen');
  let isEditMode = $state(false);

  // ── Helpers voor area-finding ────────────────────────────────────
  function findAdjacentArea(coords: Array<{ col: number; row: number }>, areaType: string, label: string): AreaRow | null {
    const cellsMap = cellsStore.get();
    const areasMap = areasStore.get();
    const seen = new Set<string>();
    for (const c of coords) seen.add(`${c.col},${c.row}`);
    for (const c of coords) {
      for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const nKey = `${c.col + dc},${c.row + dr}`;
        if (seen.has(nKey)) continue;
        const nb = cellsMap.get(nKey);
        if (nb && nb.area_id != null) {
          const a = areasMap.get(nb.area_id);
          if (a && a.area_type === areaType && (a.name || '') === (label || '')) {
            return a;
          }
        }
      }
    }
    return null;
  }

  // ── Paint handler ────────────────────────────────────────────────
  // Track of een paint-stroke al begonnen is — open na 1e cellDrag, sluit op pointerup.
  let paintStrokeOpen = false;
  function ensurePaintStroke(toolType: string) {
    if (paintStrokeOpen) return;
    paintStrokeOpen = true;
    history.begin(`Tekenen: ${toolType}`);
  }
  function endPaintStroke() {
    if (!paintStrokeOpen) return;
    paintStrokeOpen = false;
    history.commit();
  }

  async function handlePaint(coords: Array<{ col: number; row: number }>) {
    const tool = paintToolStore.get();
    if (tool.type === 'none') return;
    ensurePaintStroke(tool.type);
    const ts = Date.now();

    if (tool.type === 'eraser') {
      // Eraser: wis ALLES wat je raakt — geen speciale logica meer.
      // Zak-cellen, zak-num, muren, bunkers, custom — alles gaat weg.
      const cellsMap = cellsStore.get();
      const seen = new Set<string>();
      const toDelete: Array<{ col: number; row: number }> = [];

      for (const c of coords) {
        const k = `${c.col},${c.row}`;
        if (seen.has(k)) continue;
        const cell = cellsMap.get(k);
        if (!cell) { seen.add(k); continue; } // Lege cel, niets te wissen

        // Voor zak-cellen: wis het hele 2×2 blok (anchor + 3 buren).
        // BELANGRIJK: vóór de loop NIET k al als 'seen' markeren — anders zou
        // de anchor zelf niet aan toDelete worden toegevoegd, en blijft er
        // 1 cel van het 2×2 blok over. Markeer alle 4 cellen pas in de loop.
        if (cell.cell_type === 'zak') {
          let anchorCol = cell.col, anchorRow = cell.row;
          if (!cell.meta?.zakAnchor) {
            // Klikt op niet-anchor cel → zoek de anchor in de drie mogelijke buren
            for (const [dc, dr] of [[-1,0],[0,-1],[-1,-1]]) {
              const nc = cellsMap.get(`${cell.col+dc},${cell.row+dr}`);
              if (nc?.cell_type === 'zak' && nc?.meta?.zakAnchor) {
                anchorCol = cell.col+dc; anchorRow = cell.row+dr; break;
              }
            }
          }
          for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
            const dCol = anchorCol + dc, dRow = anchorRow + dr;
            const dk = `${dCol},${dRow}`;
            if (!seen.has(dk)) {
              seen.add(dk);
              toDelete.push({ col: dCol, row: dRow });
            }
          }
        } else {
          // Alle andere types: gewoon de cel zelf wissen
          seen.add(k);
          toDelete.push(c);
        }
      }

      if (toDelete.length) await deleteCells(toDelete);
      schedulePush();
      return;
    }

    if (tool.type === 'wall') {
      await upsertCells(coords.map((c) => ({
        col: c.col, row: c.row,
        cell_type: 'wall',
        area_id: null,
        label: '',
        meta: {},
        updated_at: ts,
      })));
      schedulePush();
      return;
    }

    if (tool.type === 'container' || tool.type === 'afval') {
      // Container/afval krijgen een area zodat hun naam ('Container' / 'Afval')
      // gerenderd wordt in het midden van het cluster (via de bestaande
      // area-label renderer in YardRenderer). Aangrenzende cellen sluiten aan
      // op een bestaande area met dezelfde naam (findAdjacentArea), anders
      // wordt een nieuwe area aangemaakt.
      const areaType = tool.type;                   // 'container' | 'afval'
      const label = tool.type === 'container'
        ? (tool.label || 'Container')
        : (tool.label || 'Afval');
      const color = tool.type === 'container' ? '#7f8c8d' : '#95a5a6';

      let target = findAdjacentArea(coords, areaType, label);
      if (!target) {
        const newArea: AreaRow = {
          id: nextTempId(),
          name: label,
          area_type: areaType,
          color,
          updated_at: ts,
        };
        await upsertArea(newArea);
        target = newArea;
      }

      await upsertCells(coords.map((c) => ({
        col: c.col, row: c.row,
        cell_type: tool.type,
        area_id: target!.id,
        label: '',
        meta: {},
        updated_at: ts,
      })));
      schedulePush();
      return;
    }

    if (tool.type === 'zak') {
      // Zak = altijd 2×2. Nummer wordt IN de zak gerenderd (geen aparte cellen).
      // Inheritance: wanneer een nieuwe zak adjacent staat aan een bestaande
      // zak in dezelfde kolom (H-orient) of rij (V-orient), neemt de nieuwe
      // het zakNum van die buur over — zo werkt doortrekken van een rij gewoon.
      // Zonder buur valt-ie terug op het nummer dat de gebruiker heeft ingevuld
      // in zakRijNumStore. (Dus géén auto-increment / géén localStorage counter.)
      const orientation = zakOrientationStore.get();
      const userRijNum = Math.floor(zakRijNumStore.get()) || 0;  // 0 = geen nummer
      const positions = new Map<string, { col: number; row: number }>();
      for (const c of coords) {
        const sc = Math.floor(c.col / 2) * 2;
        const sr = Math.floor(c.row / 2) * 2;
        positions.set(`${sc},${sr}`, { col: sc, row: sr });
      }
      const sortedPositions = [...positions.values()].sort((a, b) =>
        orientation === 'h' ? (a.col - b.col || a.row - b.row) : (a.row - b.row || a.col - b.col)
      );

      const cellsMap = cellsStore.get();
      const anchors = new Map<string, CellRow>();
      for (const c of cellsMap.values()) {
        if (c.cell_type === 'zak' && c.meta?.zakAnchor) {
          anchors.set(`${c.col},${c.row}`, c);
        }
      }

      const allUpserts: Array<Omit<CellRow, 'key'>> = [];
      let lastNewAreaId: number | string | null = null;
      // Track welke rij-nummers al een area hebben in DEZE tekensessie
      const rijToAreaId = new Map<string, number | string>();

      for (const p of sortedPositions) {
        if (anchors.has(`${p.col},${p.row}`)) continue;

        const zakNum: number = userRijNum;
        const rijKey = zakNum > 0 ? String(zakNum) : '';

        // Zoek een aangrenzende zak-anchor met hetzelfde rij-nummer
        // (alleen directe buren, niet de hele yard)
        let areaId: number | string | null = (rijKey && rijToAreaId.has(rijKey)) ? rijToAreaId.get(rijKey)! : null;
        if (!areaId && rijKey) {
          for (const [dc, dr] of [[-2,0],[2,0],[0,-2],[0,2]]) {
            const nb = anchors.get(`${p.col+dc},${p.row+dr}`);
            if (nb && String(nb.meta?.zakRij ?? nb.meta?.zakNum ?? '') === rijKey && nb.area_id != null) {
              areaId = nb.area_id;
              break;
            }
          }
        }
        if (!areaId) {
          const newArea: AreaRow = {
            id: nextTempId(),
            name: rijKey ? `Rij ${zakNum}` : '',
            area_type: 'zak',
            color: '#0E7490',
            metadata: rijKey ? { zakRij: rijKey } : {},
            updated_at: ts,
          };
          await upsertArea(newArea);
          areaId = newArea.id;
          lastNewAreaId = newArea.id;
        }
        if (rijKey) rijToAreaId.set(rijKey, areaId);

        // Plaats 4 zak-cellen — alleen anchor draagt zakNum (als er een nummer is)
        for (let dr = 0; dr < 2; dr++) {
          for (let dc = 0; dc < 2; dc++) {
            allUpserts.push({
              col: p.col + dc, row: p.row + dr,
              cell_type: 'zak',
              area_id: areaId,
              label: '',
              meta: {
                zakAnchor: dc === 0 && dr === 0,
                ...(zakNum > 0 ? { zakNum, zakRij: rijKey } : {}),
                zakOrient: orientation,
              },
              updated_at: ts,
            });
          }
        }

        // Update anchors lookup voor volgende iteratie
        anchors.set(`${p.col},${p.row}`, {
          key: `${p.col},${p.row}`, col: p.col, row: p.row,
          cell_type: 'zak', area_id: areaId, label: '',
          meta: { zakAnchor: true, ...(zakNum > 0 ? { zakNum, zakRij: rijKey } : {}), zakOrient: orientation }, updated_at: ts,
        });
      }

      if (allUpserts.length) await upsertCells(allUpserts);
      schedulePush();

      // Bewust GEEN lastPlacedAreaId.set — material picker hoort niet te
      // verschijnen tijdens het tekenen in Indeling-mode. Pas wanneer er in
      // Overzicht op een zak-rij wordt geklikt, opent de inspector + material
      // picker via handleCellClick → inspectorAreaId.
      void lastNewAreaId;
      return;
    }

    if (tool.type === 'bunker' || tool.type === 'custom') {
      const areaType = tool.type === 'bunker' ? 'bunker' : (tool.areaType || 'custom');
      const label = tool.label || '';
      const color = (tool as any).color || (tool.type === 'bunker' ? '#e67e22' : '#5dade2');

      // Zoek altijd een aangrenzende area van hetzelfde type — ook zonder label.
      // Bij lege label matchen we op areaType alleen (naam '' === '').
      let target = findAdjacentArea(coords, areaType, label);
      let isNew = false;

      if (!target) {
        const newArea: AreaRow = {
          id: nextTempId(),
          name: label,
          area_type: areaType,
          color,
          updated_at: ts,
        };
        await upsertArea(newArea);
        target = newArea;
        isNew = true;
      }

      const placedCellType: 'bunker' | 'custom' = tool.type === 'bunker' ? 'bunker' : 'custom';
      await upsertCells(coords.map((c) => ({
        col: c.col, row: c.row,
        cell_type: placedCellType,
        area_id: target!.id,
        label: '',
        meta: {},
        updated_at: ts,
      })));

      // ── Merge aangrenzende areas met afwijkende naam ──────────────
      // Doe een 4-connected flood-fill vanuit de zojuist geplaatste cellen
      // door alle cellen van hetzelfde cell_type. Cellen die in dezelfde
      // connected component zitten maar nog een andere area_id hebben
      // worden overgeschreven naar de target-area, en de oude areas
      // worden opgeruimd als ze leeg achterblijven.
      const cellsAfter = cellsStore.get();
      const visited = new Set<string>();
      const queue: Array<{ col: number; row: number }> = coords.slice();
      const reassign: Array<{ col: number; row: number; cell: any }> = [];
      const oldAreaIds = new Set<number | string>();
      while (queue.length) {
        const cur = queue.shift()!;
        const k = `${cur.col},${cur.row}`;
        if (visited.has(k)) continue;
        visited.add(k);
        const cell = cellsAfter.get(k);
        if (!cell || cell.cell_type !== placedCellType) continue;
        if (cell.area_id !== target!.id) {
          if (cell.area_id != null) oldAreaIds.add(cell.area_id);
          reassign.push({ col: cur.col, row: cur.row, cell });
        }
        for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]] as Array<[number,number]>) {
          queue.push({ col: cur.col + dc, row: cur.row + dr });
        }
      }
      if (reassign.length) {
        await upsertCells(reassign.map(({ col, row, cell }) => ({
          col, row,
          cell_type: placedCellType,
          area_id: target!.id,
          label: cell.label || '',
          meta: cell.meta || {},
          updated_at: Date.now(),
        })));
      }
      // Verwijder oude areas die nu geen cellen meer hebben
      const cellsFinal = cellsStore.get();
      for (const oldId of oldAreaIds) {
        let stillUsed = false;
        for (const c of cellsFinal.values()) {
          if (c.area_id === oldId) { stillUsed = true; break; }
        }
        if (!stillUsed) {
          await deleteArea(oldId);
        }
      }

      schedulePush();

      if (isNew && tool.type === 'bunker') {
        lastPlacedAreaId.set(target.id);
      }
      return;
    }
  }

  // Guard: voorkom dubbele inspector-opens na viewSelect
  let viewSelectJustFired = false;
  let lastInspectorOpenTime = 0;

  function openInspector(areaId: number | string, opts?: { keepSubSelection?: boolean }) {
    lastInspectorOpenTime = Date.now();
    if (!opts?.keepSubSelection) subSelectionCellsStore.set(null);
    inspectorAreaId.set(areaId);
  }

  function handleCellClick(col: number, row: number) {
    if (viewSelectJustFired) {
      viewSelectJustFired = false;
      return;
    }
    if (inspectorAreaId.get() != null) return;
    if (Date.now() - lastInspectorOpenTime < 500) return;

    const tool = paintToolStore.get();
    if (tool.type === 'pick-area') {
      handlePickArea(col, row);
      return;
    }
    const mode = modeStore.get();
    const cellsMap = cellsStore.get();
    const cell = cellsMap.get(`${col},${row}`);
    if (!cell) return;

    if (mode === 'view') {
      if (cell.cell_type === 'zak') {
        handleViewZakSelect(col, row, cell);
        return;
      }
      // Bunker/custom: alleen bestaande sub-areas met materiaal openen via klik.
      // Nieuwe sub-vlakken worden aangemaakt via rubber-band selectie.
      if (cell.area_id != null) {
        const area = areasStore.get().get(cell.area_id);
        if (area?.material_name) {
          openInspector(cell.area_id);
        }
      }
      return;
    }

    // Layout-modus fallback: open inspector voor de bestaande area
    if (cell.area_id != null) {
      openInspector(cell.area_id);
    }
  }

  // ── Overzicht: individuele bunker-cel selecteren ─────────────────
  async function handleViewCellSelect(col: number, row: number, cell: CellRow) {
    console.log('[handleViewCellSelect]', { col, row, area_id: cell.area_id });
    // Maak altijd een eigen sub-area voor deze cel zodat je er individueel
    // materiaal aan kunt toewijzen. Als de cel al een eigen area heeft
    // (1 cel = 1 area), hergebruik die.
    if (cell.area_id != null) {
      const cellsMap = cellsStore.get();
      let count = 0;
      for (const c of cellsMap.values()) {
        if (c.area_id === cell.area_id) count++;
        if (count > 1) break;
      }
      if (count === 1) {
        openInspector(cell.area_id);
        return;
      }
    }

    // Splits deze cel af van de grote area → eigen sub-area
    const ts = Date.now();
    const parentArea = cell.area_id != null ? areasStore.get().get(cell.area_id) : null;
    const newArea: AreaRow = {
      id: nextTempId(),
      name: '',
      area_type: cell.cell_type,
      color: parentArea?.color || '#9A3412',
      updated_at: ts,
    };
    await upsertArea(newArea);
    await upsertCells([{
      col, row,
      cell_type: cell.cell_type,
      area_id: newArea.id,
      label: cell.label || '',
      meta: cell.meta || {},
      updated_at: ts,
    }]);
    schedulePush();
    pendingSubAreaId.set(newArea.id);
    openInspector(newArea.id);
  }

  // ── Overzicht: zak-blok selecteren ──────────────────────────────
  // Open de nieuwe ZakMaterialPopover met S/T/Granulaat-knoppen i.p.v.
  // de Rij-area inspector. Materiaal wordt nu PER 2×2 zak opgeslagen via
  // cell.meta.zakCode (geen sub-area meer per zak).
  async function handleViewZakSelect(col: number, row: number, cell: CellRow) {
    const cellsMap = cellsStore.get();
    // Zoek de anchor van dit 2×2 blok
    let anchorCol = col, anchorRow = row;
    if (!cell.meta?.zakAnchor) {
      for (const [dc, dr] of [[-1, 0], [0, -1], [-1, -1]] as Array<[number, number]>) {
        const nc = cellsMap.get(`${col + dc},${row + dr}`);
        if (nc?.cell_type === 'zak' && nc?.meta?.zakAnchor) {
          anchorCol = col + dc; anchorRow = row + dr; break;
        }
      }
    }
    zakPickerStore.set({ anchors: [{ col: anchorCol, row: anchorRow }] });
  }

  // ── Losse-selectie tool ──────────────────────────────────────────
  // Klik op een cel → flood-fill (4-connected) naar alle aangrenzende cellen
  // van hetzelfde cell_type. Alle gevonden cellen worden aan één area
  // toegewezen zodat een kleurwijziging het hele vlak raakt.
  async function handlePickArea(col: number, row: number) {
    const cellsMap = cellsStore.get();
    const start = cellsMap.get(`${col},${row}`);
    if (!start) { toast('Klik op een getekende cel'); return; }
    if (start.cell_type === 'empty') { toast('Klik op een getekende cel'); return; }

    const BLOCKERS = new Set(['wall', 'container', 'afval']);
    if (BLOCKERS.has(start.cell_type)) {
      toast('Klik op een veld (geen muur/container/afval)');
      return;
    }
    const targetType = start.cell_type;

    // Stap 1: strict 4-connected flood-fill — alleen door cellen van
    // hetzelfde cell_type, NIET door lege posities. Dit voorkomt dat
    // ongerelateerde vlakken (bijv. zak-rijen) worden meegenomen.
    const visited = new Set<string>();
    const component: CellRow[] = [];
    const queue: Array<{ col: number; row: number }> = [{ col: start.col, row: start.row }];
    while (queue.length) {
      const cur = queue.shift()!;
      const k = `${cur.col},${cur.row}`;
      if (visited.has(k)) continue;
      visited.add(k);
      const cell = cellsMap.get(k);
      if (!cell || cell.cell_type !== targetType) continue;
      component.push(cell);
      for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]] as Array<[number,number]>) {
        queue.push({ col: cur.col + dc, row: cur.row + dr });
      }
    }
    if (component.length === 0) { toast('Geen aansluitend veld gevonden'); return; }

    // Stap 2: alle cellen die hetzelfde area_id delen met een cel in de
    // component, ook opnemen — zelfs als ze niet direct connected zijn.
    // Dit pakt eilandjes van een bestaande area mee.
    const componentAreaIds = new Set<number | string>();
    for (const c of component) {
      if (c.area_id != null) componentAreaIds.add(c.area_id);
    }
    if (componentAreaIds.size > 0) {
      for (const c of cellsMap.values()) {
        if (c.area_id != null && componentAreaIds.has(c.area_id) && c.cell_type === targetType) {
          const k = `${c.col},${c.row}`;
          if (!visited.has(k)) {
            visited.add(k);
            component.push(c);
          }
        }
      }
    }

    // Kies de area met de meeste cellen als target
    const areaCount = new Map<number | string, number>();
    for (const c of component) {
      if (c.area_id != null) {
        areaCount.set(c.area_id, (areaCount.get(c.area_id) || 0) + 1);
      }
    }

    let targetId: number | string;
    if (areaCount.size === 0) {
      const newArea: AreaRow = {
        id: nextTempId(),
        name: '',
        area_type: start.cell_type,
        color: '#5dade2',
        updated_at: Date.now(),
      };
      await upsertArea(newArea);
      targetId = newArea.id;
    } else {
      let max = 0;
      targetId = component.find(c => c.area_id != null)!.area_id!;
      for (const [aid, cnt] of areaCount) {
        if (cnt > max) { max = cnt; targetId = aid; }
      }
    }

    // Wijs ALLE cellen in de component toe aan de target area
    const ts = Date.now();
    const reassign = component
      .filter(c => c.area_id !== targetId)
      .map(c => ({
        col: c.col, row: c.row,
        cell_type: c.cell_type,
        area_id: targetId,
        label: c.label || '',
        meta: c.meta || {},
        updated_at: ts,
      }));
    if (reassign.length) {
      await upsertCells(reassign);
    }

    // Cleanup oude areas die nu leeg zijn
    const cellsAfter = cellsStore.get();
    for (const oldId of areaCount.keys()) {
      if (oldId === targetId) continue;
      let stillUsed = false;
      for (const c of cellsAfter.values()) {
        if (c.area_id === oldId) { stillUsed = true; break; }
      }
      if (!stillUsed) await deleteArea(oldId);
    }

    schedulePush();
    openInspector(targetId);
    paintToolStore.set({ type: 'none' });
  }

  // ── Overzicht: rubber-band selectie ────────────────────────────
  // Drie scenario's afhankelijk van wat de selectie bevat:
  //  1) Volledig binnen één bestaande sub-area met materiaal
  //     → open die area's inspector + zet subSelectionCellsStore zodat de
  //       gebruiker een deel-verwijder knop krijgt.
  //  2) Bevat parent-bunker cellen + (optioneel) cellen van of grenzend aan
  //     één bestaande sub-area met materiaal
  //     → pending preview met mergeIntoAreaId — formulier vooraf gevuld,
  //       Opslaan voegt cellen toe aan die area.
  //  3) Alleen parent-bunker cellen, geen aansluitende sub-area
  //     → pending preview met leeg formulier; Opslaan maakt nieuwe area.
  // GEEN DB-writes vóór Opslaan; Annuleren/X gooit alles weg.
  async function handleViewSelect(rect: SelectionRect, startCell?: { col: number; row: number } | null) {
    viewSelectJustFired = true;
    const cellsMap = cellsStore.get();
    const areasMap = areasStore.get();

    // Bepaal de intent op basis van de start-cel:
    //  - Start IN een sub-area met materiaal → "verwijder gedeelte van die area"
    //    → filter cellen tot UITSLUITEND cellen met dat area_id.
    //  - Start BUITEN een materiaal-area (parent bunker, leeg, of geen area) →
    //    "nieuw vlak / merge in parent" → filter cellen tot UITSLUITEND cellen
    //    zonder materiaal (parent bunker of leeg).
    // Resultaat: rubber-band-selectie kan visueel overal heen, maar pakt alleen
    // de cellen op die overeenkomen met het start-vlak. Multi-area selectie
    // wordt zo onmogelijk → geen verwarring meer.
    let restrictToAreaId: number | string | null | 'parent-only' = null;
    if (startCell) {
      const startCellObj = cellsMap.get(`${startCell.col},${startCell.row}`);
      if (startCellObj?.area_id != null) {
        const startArea = areasMap.get(startCellObj.area_id);
        if (startArea?.material_name) {
          // Start in materiaal-area → beperk tot die area
          restrictToAreaId = startCellObj.area_id;
        } else {
          // Start in parent (geen materiaal) → beperk tot parent-only
          restrictToAreaId = 'parent-only';
        }
      } else {
        restrictToAreaId = 'parent-only';
      }
    }

    // Categoriseer wat er in de selectie zit
    const selected: CellRow[] = [];      // bunker/custom cellen
    const zakAnchors: CellRow[] = [];    // zak-anchors (1 per 2×2 blok)
    for (let r = rect.row1; r <= rect.row2; r++) {
      for (let c = rect.col1; c <= rect.col2; c++) {
        const cell = cellsMap.get(`${c},${r}`);
        if (!cell) continue;
        if (cell.cell_type === 'bunker' || cell.cell_type === 'custom') {
          // Filter op intent (zie hierboven)
          if (restrictToAreaId === 'parent-only') {
            if (cell.area_id != null) {
              const a = areasMap.get(cell.area_id);
              if (a?.material_name) continue;
            }
          } else if (restrictToAreaId != null) {
            if (cell.area_id !== restrictToAreaId) continue;
          }
          selected.push(cell);
        } else if (cell.cell_type === 'zak' && cell.meta?.zakAnchor) {
          zakAnchors.push(cell);
        }
      }
    }

    // Zak-selectie: alleen zak-anchors in selectie en geen bunker-cellen.
    if (zakAnchors.length > 0 && selected.length === 0) {
      // Routing op basis van inhoud:
      //  - 1 zak (klik): altijd materiaal-picker (place/wijzig/wis)
      //  - 2+ zakken, ALLE leeg: materiaal-picker (batch-plaatsen op alles)
      //  - 2+ zakken, ten minste 1 gevuld: multi-popup (verplaatsen/verwijderen)
      const hasFilled = zakAnchors.some((a) => !!a.meta?.zakCode);
      if (zakAnchors.length === 1 || !hasFilled) {
        zakPickerStore.set({
          anchors: zakAnchors.map((a) => ({ col: a.col, row: a.row })),
        });
        return;
      }
      zakMultiSelectStore.set({
        anchors: zakAnchors.map((a) => ({
          col: a.col,
          row: a.row,
          zakCode: String(a.meta?.zakCode || ''),
          zakRij: String(a.meta?.zakRij ?? a.meta?.zakNum ?? ''),
          zakOrient: (a.meta?.zakOrient === 'v' ? 'v' : 'h') as 'h' | 'v',
        })),
      });
      return;
    }

    if (selected.length === 0) return;

    // Categoriseer cellen: in welke sub-areas-met-materiaal vallen ze, en
    // hoeveel zitten er nog "los" in de parent bunker (geen materiaal).
    const subAreaCellCount = new Map<number | string, number>();
    let parentBunkerCells = 0;
    for (const c of selected) {
      if (c.area_id == null) { parentBunkerCells++; continue; }
      const a = areasMap.get(c.area_id);
      if (a?.material_name) {
        subAreaCellCount.set(c.area_id, (subAreaCellCount.get(c.area_id) || 0) + 1);
      } else {
        parentBunkerCells++;
      }
    }

    // Case 1: alle cellen liggen IN één bestaande sub-area met materiaal.
    // Open de AreaInspector met sub-selection — gebruiker krijgt daar de
    // qty-form om partijen aan te passen / cellen te verwijderen.
    if (subAreaCellCount.size === 1 && parentBunkerCells === 0) {
      const onlyAreaId = [...subAreaCellCount.keys()][0];
      subSelectionCellsStore.set(selected.map((c) => ({ col: c.col, row: c.row })));
      pendingSelectionStore.set(null);
      openInspector(onlyAreaId, { keepSubSelection: true });
      return;
    }

    // Cases 2 & 3: pending preview. Bepaal of er gemerged kan worden in een
    // aangrenzende of overlappende sub-area met materiaal.
    let mergeInto: AreaRow | null = null;
    if (subAreaCellCount.size === 1) {
      // Selectie raakt exact één sub-area + heeft parent cellen → merge daarin.
      const aid = [...subAreaCellCount.keys()][0];
      mergeInto = areasMap.get(aid) || null;
    } else if (subAreaCellCount.size === 0) {
      // Geen sub-area cellen geraakt — kijk naar BUREN voor merge-target.
      const selectedKeys = new Set(selected.map((c) => `${c.col},${c.row}`));
      for (const c of selected) {
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
          const nk = `${c.col + dc},${c.row + dr}`;
          if (selectedKeys.has(nk)) continue;
          const nb = cellsMap.get(nk);
          if (nb && nb.area_id != null && nb.cell_type === c.cell_type) {
            const nbArea = areasMap.get(nb.area_id);
            if (nbArea?.material_name) { mergeInto = nbArea; break; }
          }
        }
        if (mergeInto) break;
      }
    }
    // Bij subAreaCellCount.size > 1: meerdere sub-areas geraakt → per partij
    // vragen hoeveel er nog staan, geselecteerde cellen teruggeven aan parent.
    if (subAreaCellCount.size > 1) {
      const ts = Date.now();
      for (const [aid, count] of subAreaCellCount) {
        const area = areasMap.get(aid);
        if (!area?.material_name) continue;
        const matName = area.material_name.replace(/\s+[STst]$/, '').trim();
        const currentQty = area.metadata?.quantity || '?';
        const partyCells = selected.filter(c => c.area_id === aid);
        const input = prompt(
          `${matName}: er staan ${currentQty} partijen.\n` +
          `Je verwijdert ${partyCells.length} cellen.\n\n` +
          `Hoeveel partijen staan er nog?`,
          String(currentQty)
        );
        if (input === null) continue;
        const newQty = Number(input) || 0;

        // Zoek parent bunker-area (het lege bunker-veld, NIET een andere partij)
        const neighborAreaIds = new Map<number | string, number>();
        for (const c of partyCells) {
          for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nb = cellsMap.get(`${c.col+dc},${c.row+dr}`);
            if (nb && nb.area_id != null && nb.area_id !== aid && nb.cell_type === c.cell_type) {
              const nbArea = areasMap.get(nb.area_id);
              // Alleen het lege bunker-veld (geen materiaal) als parent
              if (!nbArea?.material_name) {
                neighborAreaIds.set(nb.area_id, (neighborAreaIds.get(nb.area_id) || 0) + 1);
              }
            }
          }
        }
        let parentAreaId: number | string | null = null;
        let maxCnt = 0;
        for (const [naid, cnt] of neighborAreaIds) {
          if (cnt > maxCnt) { maxCnt = cnt; parentAreaId = naid; }
        }

        // Geef geselecteerde cellen terug aan parent
        if (parentAreaId != null) {
          await upsertCells(partyCells.map(c => ({
            col: c.col, row: c.row,
            cell_type: c.cell_type,
            area_id: parentAreaId!,
            label: '', meta: c.meta || {},
            updated_at: ts,
          })));
        }

        // Update partij-aantal
        if (newQty > 0) {
          await upsertArea({ ...area, metadata: { ...area.metadata, quantity: newQty }, updated_at: ts });
        } else {
          // Check of er nog cellen over zijn in deze area (gebruik verse store)
          const freshCells = cellsStore.get();
          const remaining = [...freshCells.values()].filter(c => c.area_id === aid);
          if (remaining.length === 0) {
            await deleteArea(aid);
          } else {
            await upsertArea({ ...area, material_name: null, metadata: { ...area.metadata, quantity: null, date: null }, updated_at: ts });
          }
        }
      }
      schedulePush();
      toast('Partijen bijgewerkt');
      return;
    }

    // Parent-kleur voor preview (kleur van de "achtergrond" bunker)
    const parentArea = selected[0].area_id != null ? areasMap.get(selected[0].area_id) : null;
    pendingSelectionStore.set({
      cells: selected.map((c) => ({
        col: c.col,
        row: c.row,
        cell_type: c.cell_type,
        area_id: c.area_id ?? null,
      })),
      parentColor: parentArea?.color || '#9A3412',
      mergeIntoAreaId: mergeInto?.id ?? null,
      mergeIntoMaterial: mergeInto?.material_name ?? null,
      mergeIntoQuantity:
        (mergeInto?.metadata?.quantity != null ? Number(mergeInto.metadata.quantity) : null),
      mergeIntoDate: (mergeInto?.metadata?.date as string | null) ?? null,
    });
    subSelectionCellsStore.set(null);
  }

  // ── Selectie callbacks (verplaatsen + resizen) ───────────────────
  async function handleSelectionMove(from: SelectionRect, to: SelectionRect) {
    history.begin('Selectie verplaatsen');
    try {
      await _doMove(from, to);
    } finally {
      history.commit();
    }
  }

  async function _doMove(from: SelectionRect, to: SelectionRect) {
    const all = cellsStore.get();
    const cells = [...all.values()].filter(
      (c) => c.col >= from.col1 && c.col <= from.col2 && c.row >= from.row1 && c.row <= from.row2
    );
    if (cells.length === 0) return;
    const dx = to.col1 - from.col1;
    const dy = to.row1 - from.row1;
    if (dx === 0 && dy === 0) return;

    // Eerst weghalen op oude posities
    await deleteCells(cells.map((c) => ({ col: c.col, row: c.row })));
    // Dan plaatsen op nieuwe posities (overschrijft eventuele bestaande cellen daar)
    const ts = Date.now();
    await upsertCells(cells.map((c) => ({
      col: c.col + dx, row: c.row + dy,
      area_id: c.area_id ?? null,
      cell_type: c.cell_type,
      label: c.label || '',
      meta: c.meta || {},
      updated_at: ts,
    })));
    schedulePush();
    // Update renderer-selectie zodat handles op nieuwe positie zitten
    renderer?.setSelection(to);
  }

  async function handleSelectionResize(from: SelectionRect, to: SelectionRect) {
    history.begin('Selectie resizen');
    try {
      await _doResize(from, to);
    } finally {
      history.commit();
    }
  }

  async function _doResize(from: SelectionRect, to: SelectionRect) {
    const fromW = from.col2 - from.col1 + 1;
    const fromH = from.row2 - from.row1 + 1;
    const toW = to.col2 - to.col1 + 1;
    const toH = to.row2 - to.row1 + 1;

    // Verzamel patroon (geïndexeerd op delta vanaf from-rect oorsprong)
    const all = cellsStore.get();
    const pattern = new Map<string, CellRow>();
    for (const c of all.values()) {
      if (c.col >= from.col1 && c.col <= from.col2 && c.row >= from.row1 && c.row <= from.row2) {
        pattern.set(`${c.col - from.col1},${c.row - from.row1}`, c);
      }
    }

    // Weg te halen: alle cellen in from EN in to (clean overschrijven)
    const toRemove: Array<{ col: number; row: number }> = [];
    for (const c of all.values()) {
      const inFrom = c.col >= from.col1 && c.col <= from.col2 && c.row >= from.row1 && c.row <= from.row2;
      const inTo = c.col >= to.col1 && c.col <= to.col2 && c.row >= to.row1 && c.row <= to.row2;
      if (inFrom || inTo) toRemove.push({ col: c.col, row: c.row });
    }
    if (toRemove.length) await deleteCells(toRemove);

    // Bouw nieuwe cellen via lineaire schaal (nearest-neighbor)
    const ts = Date.now();
    const newCells: Array<Omit<CellRow, 'key'>> = [];
    for (let dy = 0; dy < toH; dy++) {
      for (let dx = 0; dx < toW; dx++) {
        const sx = Math.min(fromW - 1, Math.floor((dx * fromW) / toW));
        const sy = Math.min(fromH - 1, Math.floor((dy * fromH) / toH));
        const src = pattern.get(`${sx},${sy}`);
        if (src) {
          newCells.push({
            col: to.col1 + dx, row: to.row1 + dy,
            area_id: src.area_id ?? null,
            cell_type: src.cell_type,
            label: src.label || '',
            meta: src.meta || {},
            updated_at: ts,
          });
        }
      }
    }
    if (newCells.length) await upsertCells(newCells);
    schedulePush();
    renderer?.setSelection(to);
  }

  function handleSelectionChange(_sel: SelectionRect | null) {
    // Plek voor toekomstige UI-state als nodig
  }

  // ── Init in onMount, met directe subscriptions zodat reactiviteit waterdicht is ─
  let unsubs: Array<() => void> = [];

  function updatePaintMode() {
    if (!renderer) return;
    const m = modeStore.get();
    const p = paintToolStore.get();
    const lock = lineLockStore.get();
    const b = brushSizeStore.get();
    const orient = zakOrientationStore.get();
    isEditMode = (m === 'layout');
    renderer.setEditMode(isEditMode);

    // Snap-grid bepalen op basis van tool
    if (p.type === 'zak') {
      renderer.snapToGrid = { w: 2, h: 2 };
    } else {
      renderer.snapToGrid = null;
    }

    if (m === 'layout' && p.type === 'pick-area') {
      // Klik-modus — geen rubber-band, geen paint
      renderer.paintMode = 'none';
      renderer.clearSelection();
      renderer.setBackgroundDraggable(false);
      activeToolLabel = '👆 Losse selectie — tik op een getekend vlak om het hele aansluitende veld te selecteren';
    } else if (m === 'layout' && p.type === 'select') {
      renderer.paintMode = 'select';
      renderer.setBackgroundDraggable(false);
      activeToolLabel = '🎯 Selecteren — sleep een rechthoek; daarna handles voor verplaatsen/resizen (Shift = proportioneel)';
    } else if (m === 'layout' && p.type === 'background') {
      // Achtergrond-modus: geen paint, geen rubber-band — alleen image draggable
      renderer.paintMode = 'none';
      renderer.clearSelection();
      renderer.setBackgroundDraggable(true);
      activeToolLabel = '🖼 Achtergrond — sleep de afbeelding om te verplaatsen';
    } else if (m === 'layout' && p.type !== 'none') {
      renderer.paintMode = 'paint';
      renderer.clearSelection();
      renderer.setBackgroundDraggable(false);
      const lockSuffix = lock ? '  · 📏 lijn-lock' : '';
      let sizeSuffix = '';
      if (p.type === 'zak') sizeSuffix = `  · 2×2 zak`;
      else if (b.w > 1 || b.h > 1) sizeSuffix = `  · penseel ${b.w}×${b.h}`;
      activeToolLabel = labelForTool(p) + sizeSuffix + lockSuffix;
    } else if (m === 'layout') {
      renderer.paintMode = 'none';
      renderer.clearSelection();
      renderer.setBackgroundDraggable(false);
      activeToolLabel = '🛠 Indeling-modus — kies een tool rechts om te tekenen';
    } else {
      // Overzicht-modus — pan/zoom + klikken op vlak voor info/materiaal
      renderer.paintMode = 'none';
      renderer.clearSelection();
      renderer.setBackgroundDraggable(false);
      activeToolLabel = 'Overzicht — tik op een vlak voor materiaal of info';
    }
  }

  function labelForTool(p: any): string {
    switch (p.type) {
      case 'select': return '🎯 Selecteren — sleep een rechthoek';
      case 'background': return '🖼 Achtergrond — sleep om te verplaatsen';
      case 'wall': return '🧱 Muur — sleep om te tekenen';
      case 'container': return '📦 Container — sleep om te tekenen';
      case 'afval': return '🗑 Afval — sleep om te tekenen';
      case 'zak': return '⬜ Zak-cel — sleep om te tekenen';
      case 'bunker': return `🟧 Bunker ${p.label || ''} — sleep`;
      case 'custom': return `🎨 ${p.label || 'Vlak'} — sleep`;
      case 'eraser': return '🧹 Wissen — sleep om cellen te wissen';
      default: return 'Geen tool';
    }
  }

  // Performance: coalesce multiple cellsStore/areasStore updates within ~80ms into a
  // single rerender via requestAnimationFrame + a trailing timer. Differential update
  // would be lower-cost per frame but requires reworking the area-edge / label logic
  // in YardRenderer; debounced rerender is the lower-risk path for Phase 1.
  let rerenderQueued = false;
  let rerenderRafId: number | null = null;
  let rerenderTimerId: number | null = null;
  const RERENDER_DEBOUNCE_MS = 80;

  function rerenderNow() {
    rerenderQueued = false;
    if (rerenderRafId != null) { cancelAnimationFrame(rerenderRafId); rerenderRafId = null; }
    if (rerenderTimerId != null) { clearTimeout(rerenderTimerId); rerenderTimerId = null; }
    if (!renderer) return;
    renderer.renderCells(cellsStore.get(), areasStore.get());
  }

  function rerender() {
    if (!renderer) return;
    if (rerenderQueued) return;
    rerenderQueued = true;
    // Coalesce burst of mutations: schedule next-rAF, capped by RERENDER_DEBOUNCE_MS trailing.
    rerenderRafId = requestAnimationFrame(() => {
      rerenderRafId = null;
      // If another mutation arrives within the debounce window, that one will already
      // see rerenderQueued=true and skip; we just paint here.
      rerenderNow();
    });
    if (rerenderTimerId == null) {
      rerenderTimerId = window.setTimeout(() => {
        rerenderTimerId = null;
        if (rerenderQueued) rerenderNow();
      }, RERENDER_DEBOUNCE_MS);
    }
  }

  function initRenderer() {
    if (renderer) return;
    if (!container) return;
    // Wacht tot container daadwerkelijk afmetingen heeft
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) {
      requestAnimationFrame(initRenderer);
      return;
    }
    renderer = new YardRenderer({
      container,
      onCellDrag: handlePaint,
      onCellClick: handleCellClick,
      onSelectionMove: handleSelectionMove,
      onSelectionResize: handleSelectionResize,
      onSelectionChange: handleSelectionChange,
      onViewSelect: handleViewSelect,
      canViewSelect: (col, row) => {
        const cell = cellsStore.get().get(`${col},${row}`);
        if (!cell) return false;
        if (cell.cell_type === 'bunker' || cell.cell_type === 'custom') return true;
        // Zak-cellen: snap rubber-band naar 2×2 anchor-grid zodat de
        // selectie alleen in hele zak-blokken kan groeien.
        if (cell.cell_type === 'zak') return '2x2' as const;
        return false;
      },
      onBackgroundMoved: (x, y, autoCentered) => {
        // autoCentered = true → renderer heeft zelf gecentreerd bij eerste laad.
        // Markeer dan ook als initialized zodat we niet opnieuw centreren bij volgende mount.
        backgroundImageStore.update((s) => ({
          ...s,
          x, y,
          initialized: true,
          // Bij auto-centreren laten we visible ongemoeid (gebruiker kiest zelf wanneer aan)
          visible: autoCentered ? s.visible : s.visible,
        }));
      },
    });
    renderer.lockAxis = lineLockStore.get();
    renderer.tlStateGetter = () => traylijnStore.get();
    const initBrush = brushSizeStore.get();
    renderer.brushW = initBrush.w;
    renderer.brushH = initBrush.h;

    // Achtergrond-afbeelding: laad en pas opgeslagen state toe.
    // De renderer centreert zelf bij eerste laad als !initialized.
    const bg = backgroundImageStore.get();
    renderer.setBackgroundImageOpacity(bg.opacity);
    // Schaal MOET worden gezet vóór loadBackgroundImage zodat de eerste centrering
    // de geschaalde dimensies gebruikt. silent=true → geen onBackgroundMoved callback.
    renderer.setBackgroundImageScale(bg.scale, true);
    renderer.setBackgroundImageVisible(bg.visible);
    renderer.loadBackgroundImage('/background.png');
    // Synchroniseer renderer met de store zodra de image geladen is.
    // We pollen tot de Konva.Image bestaat en lezen dan de VERSE store-state
    // (de gebruiker kan tijdens laden al hebben verplaatst/geschaald).
    const tryRestore = () => {
      if (!renderer) return;
      const ok = (renderer as any).bgImage != null;
      if (ok) {
        const fresh = backgroundImageStore.get();
        renderer.setBackgroundImageScale(fresh.scale, true);
        if (fresh.initialized) {
          renderer.setBackgroundImagePosition(fresh.x, fresh.y);
        }
      } else {
        setTimeout(tryRestore, 50);
      }
    };
    tryRestore();

    rerenderNow();
    updatePaintMode();
    // Eerste keer fit op data (als die er is)
    const cells = cellsStore.get();
    if (cells.size > 0) {
      renderer.fitToContent([...cells.values()]);
    }
  }

  // Sluit lopende paint stroke (history commit) bij elke pointerup
  function onWindowPointerUp() {
    if (paintStrokeOpen) endPaintStroke();
  }

  // Centreer-knop in TabIndeling stuurt deze event af
  function onWindowBgRecenter() {
    if (!renderer) return;
    const pos = renderer.centerBackgroundImage();
    if (pos) {
      backgroundImageStore.update((s) => ({ ...s, x: pos.x, y: pos.y, initialized: true }));
    }
  }

  // Reset-event: positie + scale terug naar default (gecentreerd, 100%).
  // Atomair: eerst scale, dan centreren (anders zou centreren met oude scale gebeuren).
  function onWindowBgReset() {
    if (!renderer) return;
    renderer.setBackgroundImageScale(1, true);
    const pos = renderer.centerBackgroundImage();
    backgroundImageStore.update((s) => ({
      ...s,
      scale: 1,
      x: pos?.x ?? s.x,
      y: pos?.y ?? s.y,
      initialized: true,
    }));
  }

  // Keyboard: Ctrl+Z = undo, Ctrl+Shift+Z of Ctrl+Y = redo
  function onWindowKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    if (ctrlOrMeta && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    } else if (ctrlOrMeta && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      history.redo();
    }
  }

  onMount(() => {
    requestAnimationFrame(initRenderer);

    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('yard-bg-recenter', onWindowBgRecenter as EventListener);
    window.addEventListener('yard-bg-reset', onWindowBgReset as EventListener);
    unsubs.push(() => window.removeEventListener('pointerup', onWindowPointerUp));
    unsubs.push(() => window.removeEventListener('pointercancel', onWindowPointerUp));
    unsubs.push(() => window.removeEventListener('keydown', onWindowKeyDown));
    unsubs.push(() => window.removeEventListener('yard-bg-recenter', onWindowBgRecenter as EventListener));
    unsubs.push(() => window.removeEventListener('yard-bg-reset', onWindowBgReset as EventListener));

    // Subscriptions: gegarandeerd reactief
    unsubs.push(cellsStore.subscribe(rerender));
    unsubs.push(areasStore.subscribe(rerender));
    unsubs.push(modeStore.subscribe(updatePaintMode));
    unsubs.push(paintToolStore.subscribe(updatePaintMode));
    unsubs.push(lineLockStore.subscribe((v) => {
      if (renderer) renderer.lockAxis = v;
      updatePaintMode();
    }));
    unsubs.push(brushSizeStore.subscribe((b) => {
      if (renderer) {
        renderer.brushW = b.w;
        renderer.brushH = b.h;
      }
      updatePaintMode();
    }));
    unsubs.push(zakOrientationStore.subscribe(updatePaintMode));
    unsubs.push(zakRijNumStore.subscribe(updatePaintMode));

    // Pending selectie preview — toont de nog-niet-opgeslagen rubber-band
    // selectie als dashed outline + lichte witte overlay op de cellen.
    unsubs.push(pendingSelectionStore.subscribe((sel) => {
      if (!renderer) return;
      renderer.setPendingPreview(sel ? sel.cells.map((c) => ({ col: c.col, row: c.row })) : null);
    }));

    // Traylijn-state: tlStateGetter wijst direct naar traylijnStore.get()
    // zodat renderCells altijd de actuele waarde leest. Bij elke verandering
    // van de store force-rerenderen we zodat alle zak-labels opnieuw
    // gegenereerd worden met de nieuwe TL-naam.
    if (renderer) {
      renderer.tlStateGetter = () => traylijnStore.get();
    }
    unsubs.push(traylijnStore.subscribe(() => {
      if (!renderer) return;
      rerender();
    }));

    // Zak-multi-select preview: teken de geselecteerde 2×2 anchors als
    // dashed overlay (hergebruik pending-preview visueel).
    unsubs.push(zakMultiSelectStore.subscribe((sel) => {
      if (!renderer) return;
      if (!sel) {
        renderer.setPendingPreview(null);
        return;
      }
      // Anchor = top-left van 2×2; vul alle 4 cellen voor de overlay
      const cells: Array<{ col: number; row: number }> = [];
      for (const a of sel.anchors) {
        for (let dr = 0; dr < 2; dr++) {
          for (let dc = 0; dc < 2; dc++) {
            cells.push({ col: a.col + dc, row: a.row + dr });
          }
        }
      }
      renderer.setPendingPreview(cells);
    }));

    // Sub-selectie binnen een bestaande sub-area (voor partial-delete).
    unsubs.push(subSelectionCellsStore.subscribe((cells) => {
      if (!renderer) return;
      renderer.setSubSelectionPreview(cells);
    }));

    // Achtergrond-afbeelding: ALLE veranderingen (visible/opacity/scale/positie)
    // lopen via deze subscribe. Schalen verschuift de positie (anker = midden);
    // we lezen die nieuwe positie terug uit de renderer en pre-empten bgLast om
    // recursie te breken.
    let bgLast = backgroundImageStore.get();
    unsubs.push(backgroundImageStore.subscribe((s) => {
      if (!renderer) return;
      const visChanged = s.visible !== bgLast.visible;
      const opChanged = s.opacity !== bgLast.opacity;
      const scaleChanged = s.scale !== bgLast.scale;
      const posChanged = s.x !== bgLast.x || s.y !== bgLast.y;

      if (visChanged) renderer.setBackgroundImageVisible(s.visible);
      if (opChanged) renderer.setBackgroundImageOpacity(s.opacity);

      if (scaleChanged) {
        renderer.setBackgroundImageScale(s.scale, true);
        const newPos = renderer.getBackgroundImagePosition();
        if (newPos && (newPos.x !== s.x || newPos.y !== s.y)) {
          // Pre-empt: zet bgLast nu al op de toekomstige store-state
          // zodat de recursieve subscribe-call er niets meer mee doet.
          bgLast = { ...s, x: newPos.x, y: newPos.y };
          backgroundImageStore.update((st) => ({ ...st, x: newPos.x, y: newPos.y }));
          return;
        }
      }

      // Positie-update alleen toepassen als die niet net door scaling is gezet
      if (posChanged && !scaleChanged) {
        renderer.setBackgroundImagePosition(s.x, s.y);
      }

      bgLast = s;
    }));

    // Resize observer voor robust resize handling
    const ro = new ResizeObserver(() => {
      if (renderer && container) {
        renderer.handleResize();
      }
    });
    ro.observe(container);
    unsubs.push(() => ro.disconnect());
  });

  onDestroy(() => {
    unsubs.forEach((u) => u());
    renderer?.destroy();
  });

  export function zoomIn() { renderer?.zoom(1.2); }
  export function zoomOut() { renderer?.zoom(1 / 1.2); }
  export function fit() { renderer?.fitToContent([...cellsStore.get().values()]); }
</script>

<div class="canvas-wrap" class:is-edit={isEditMode}>
  <div bind:this={container} class="canvas"></div>
  <div class="status-bar" class:edit={isEditMode}>{activeToolLabel}</div>
</div>

<style>
  .canvas-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }
  .canvas {
    flex: 1;
    width: 100%;
    /* Overzicht: schoon licht grijs — geen stippen, geen grid */
    background: #f4f6f8;
    overflow: hidden;
    position: relative;
    touch-action: none;
    min-height: 0;
  }
  /* Indeling-modus: cross-hatch achtergrond zodat het grid duidelijk in beeld komt */
  .canvas-wrap.is-edit .canvas {
    background:
      linear-gradient(rgba(20,30,50,0.04) 1px, transparent 1px) 0 0 / 24px 24px,
      linear-gradient(90deg, rgba(20,30,50,0.04) 1px, transparent 1px) 0 0 / 24px 24px,
      radial-gradient(circle at 1px 1px, rgba(20,30,50,0.18) 1px, transparent 0) 0 0 / 24px 24px,
      #eef0f3;
  }
  .status-bar {
    background: rgba(44, 62, 80, 0.92);
    color: #fff;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }
</style>
