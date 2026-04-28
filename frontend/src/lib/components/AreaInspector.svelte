<script lang="ts">
  import { areasStore, cellsStore, upsertArea, deleteArea, upsertCells, nextTempId } from '../stores/state';
  import { inspectorAreaId, modeStore, authStore, toast, pendingSubAreaId, pendingSelectionStore, subSelectionCellsStore } from '../stores/ui';
  import type { AreaRow } from '../db/dexie';
  import { schedulePush } from '../sync/engine';
  import { useStore } from '../useStore.svelte';
  import MaterialPicker from './MaterialPicker.svelte';
  import { currentPeriodStore, formatPeriod, setMaterialForArea, getMaterialForAreaInPeriod, laterQuartersInYear } from '../stores/period';

  const inspector = useStore(inspectorAreaId);
  const areas = useStore(areasStore);
  const cells = useStore(cellsStore);
  const mode = useStore(modeStore);
  const auth = useStore(authStore);
  const currentPeriod = useStore(currentPeriodStore);
  const pendingSel = useStore(pendingSelectionStore);
  const subSelCells = useStore(subSelectionCellsStore);

  const area = $derived(inspector.value != null ? areas.value.get(inspector.value) : null);
  // Pending = de gebruiker heeft een rubber-band selectie gemaakt maar nog niets opgeslagen.
  // In deze modus tonen we de inspector zonder dat er een echte area in de store zit.
  const isPending = $derived(pendingSel.value != null && inspector.value == null);
  // Sub-selection actief = rubber-band binnen een bestaande sub-area (cellen
  // worden in de UI gehighlight, en een knop "Verwijder geselecteerde cellen"
  // verschijnt — voor partial-delete).
  const subSelCount = $derived(subSelCells.value?.length ?? 0);
  const isSubSel = $derived(!!area && subSelCount > 0);
  const showInspector = $derived(!!area || isPending);
  const canEdit = $derived(auth.value?.role === 'admin' || auth.value?.role === 'supervisor');
  // Materiaal-keuze is alleen logisch voor zak/bunker/custom — niet voor wall/container/afval
  const supportsMaterial = $derived(
    isPending || (area && ['zak', 'bunker', 'custom'].includes(area.area_type))
  );
  // Cell count voor de header (echte area: tel store-cellen, pending: lengte van selectie)
  const cellCount = $derived(
    isPending
      ? (pendingSel.value?.cells.length ?? 0)
      : (area ? [...cells.value.values()].filter((c) => c.area_id === area.id).length : 0)
  );
  const headerColor = $derived(
    isPending ? (pendingSel.value?.parentColor || '#9A3412') : (area?.color || '#2c3e50')
  );
  const headerType = $derived(isPending ? (pendingSel.value?.cells[0]?.cell_type || 'bunker') : area?.area_type);
  const headerName = $derived(isPending ? 'Nieuw vlak' : (area?.name || 'Naamloos vlak'));

  let editName = $state('');
  let editMaterial = $state('');
  let editColor = $state('#e67e22');
  let editQuantity = $state('');
  let editDate = $state('');
  let applyToFuture = $state(false);

  // Cache laatst-bewerkte area-id zodat we materiaal niet pakken voordat 'area' update is
  let lastSeenId: number | string | null = null;
  let lastPendingFlag = false;
  $effect(() => {
    if (area && area.id !== lastSeenId) {
      lastSeenId = area.id;
      lastPendingFlag = false;
      editName = area.name || '';
      editColor = area.color || '#e67e22';
      editQuantity = area.metadata?.quantity ? String(area.metadata.quantity) : '';
      editDate = area.metadata?.date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date());
      applyToFuture = false;
      confirmingDelete = false;
    } else if (isPending && !lastPendingFlag) {
      // Eerste opening van pending-selectie: vul formulier vooraf met
      // mergeInto-waarden (als de selectie aansluit op een bestaande sub-area
      // met materiaal), anders leeg + vandaag als datum.
      lastPendingFlag = true;
      lastSeenId = null;
      const sel = pendingSel.value;
      editName = '';
      editColor = '#e67e22';
      editMaterial = sel?.mergeIntoMaterial ?? '';
      editQuantity = sel?.mergeIntoQuantity != null ? String(sel.mergeIntoQuantity) : '';
      editDate = sel?.mergeIntoDate
        ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date());
      applyToFuture = false;
      confirmingDelete = false;
    } else if (!area && !isPending) {
      lastSeenId = null;
      lastPendingFlag = false;
    }
  });
  // Materiaal: synchroniseer met current period whenever area or period changes
  $effect(() => {
    if (!area) return;
    const m = getMaterialForAreaInPeriod(area, currentPeriod.value);
    editMaterial = m || '';
  });

  const currentMaterial = $derived(area ? getMaterialForAreaInPeriod(area, currentPeriod.value) : null);

  function close() {
    pendingSubAreaId.set(null);
    pendingSelectionStore.set(null);
    subSelectionCellsStore.set(null);
    inspectorAreaId.set(null);
  }

  // Annuleren: pending preview gewoon weggooien (geen DB-impact, niets te
  // rollbacken want we hebben nooit upserted).
  function cancel() {
    close();
  }

  // Pending-mode partial-delete: gebruiker heeft een rubber-band gemaakt die
  // overlapt met één of meerdere bestaande sub-areas (met materiaal) — kiest
  // "Verwijderen". Voor elke geselecteerde cel die in een sub-area zit, geef
  // 'm terug aan de parent bunker (lege buur-area van hetzelfde type). Cellen
  // die al in een lege parent zitten blijven zoals ze zijn. Cleanup van lege
  // sub-areas erna.
  async function removePendingSelectionCells() {
    const sel = pendingSel.value;
    if (!sel || sel.cells.length === 0) { close(); return; }
    const cellsMap = cellsStore.get();
    const areasMap = areasStore.get();
    const ts = Date.now();

    // Welke cellen zitten in een sub-area met materiaal?
    const cellsToFreeze = sel.cells.filter((c) => {
      if (c.area_id == null) return false;
      const a = areasMap.get(c.area_id);
      return !!(a && a.material_name);
    });

    if (cellsToFreeze.length === 0) {
      toast('Geen materiaal in selectie om te verwijderen');
      close();
      return;
    }

    // Per sub-area: zoek de parent bunker (meest aangrenzende lege area).
    const subAreasInvolved = new Set<number | string>();
    for (const c of cellsToFreeze) {
      if (c.area_id != null) subAreasInvolved.add(c.area_id);
    }
    const subToParent = new Map<number | string, number | string | null>();
    for (const subId of subAreasInvolved) {
      const counts = new Map<number | string, number>();
      for (const c of cellsMap.values()) {
        if (c.area_id !== subId) continue;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
          const nb = cellsMap.get(`${c.col + dc},${c.row + dr}`);
          if (!nb || nb.area_id == null || nb.area_id === subId) continue;
          if (nb.cell_type !== c.cell_type) continue;
          const nbArea = areasMap.get(nb.area_id);
          if (nbArea && !nbArea.material_name) {
            counts.set(nb.area_id, (counts.get(nb.area_id) || 0) + 1);
          }
        }
      }
      let parentId: number | string | null = null;
      let maxN = 0;
      for (const [aid, cnt] of counts) {
        if (cnt > maxN) { maxN = cnt; parentId = aid; }
      }
      subToParent.set(subId, parentId);
    }

    // Apply: herwijs cellen naar parent (of null als geen parent gevonden).
    await upsertCells(cellsToFreeze.map((c) => {
      const orig = cellsMap.get(`${c.col},${c.row}`);
      return {
        col: c.col,
        row: c.row,
        cell_type: orig?.cell_type ?? c.cell_type,
        area_id: subToParent.get(c.area_id!) ?? null,
        label: '',
        meta: orig?.meta || {},
        updated_at: ts,
      };
    }));

    // Cleanup: lege sub-areas verwijderen.
    const cellsAfter = cellsStore.get();
    for (const subId of subAreasInvolved) {
      let stillUsed = false;
      for (const c of cellsAfter.values()) {
        if (c.area_id === subId) { stillUsed = true; break; }
      }
      if (!stillUsed) {
        await deleteArea(subId);
      }
    }

    schedulePush();
    toast(`${cellsToFreeze.length} cel${cellsToFreeze.length === 1 ? '' : 'len'} uit vlak verwijderd`);
    close();
  }

  // Partial-delete: gebruiker heeft een rubber-band gemaakt binnen een
  // bestaande sub-area en kiest "Verwijder geselecteerde cellen". Geef die
  // cellen terug aan de parent bunker (de grootste buur-area van hetzelfde
  // type die GEEN materiaal heeft). Als na verwijderen de sub-area leeg is,
  // verwijder de area zelf.
  async function removeSubSelection() {
    if (!area) { close(); return; }
    const subCells = subSelCells.value;
    if (!subCells || subCells.length === 0) { close(); return; }
    const cellsMap = cellsStore.get();
    const areasMap = areasStore.get();
    const ts = Date.now();

    // Zoek de parent bunker-area (meest aangrenzende area van hetzelfde type
    // die geen materiaal heeft → de "lege" bunker waar deze sub-area in zit).
    const subKeySet = new Set(subCells.map((c) => `${c.col},${c.row}`));
    const neighborCount = new Map<number | string, number>();
    for (const sc of subCells) {
      for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const nk = `${sc.col + dc},${sc.row + dr}`;
        if (subKeySet.has(nk)) continue;
        const nb = cellsMap.get(nk);
        if (!nb || nb.area_id == null || nb.area_id === area.id) continue;
        if (nb.cell_type !== area.area_type) continue;
        const nbArea = areasMap.get(nb.area_id);
        if (nbArea && !nbArea.material_name) {
          neighborCount.set(nb.area_id, (neighborCount.get(nb.area_id) || 0) + 1);
        }
      }
    }
    let parentBunkerId: number | string | null = null;
    let maxN = 0;
    for (const [aid, cnt] of neighborCount) {
      if (cnt > maxN) { maxN = cnt; parentBunkerId = aid; }
    }

    // Geef de geselecteerde cellen terug aan de parent bunker.
    if (parentBunkerId != null) {
      await upsertCells(subCells.map((c) => {
        const orig = cellsMap.get(`${c.col},${c.row}`);
        return {
          col: c.col,
          row: c.row,
          cell_type: orig?.cell_type ?? area.area_type,
          area_id: parentBunkerId!,
          label: '',
          meta: orig?.meta || {},
          updated_at: ts,
        };
      }));
    } else {
      // Geen parent gevonden → cellen los (area_id null) zodat ze geen
      // weeskinderen blijven in de oude sub-area.
      await upsertCells(subCells.map((c) => {
        const orig = cellsMap.get(`${c.col},${c.row}`);
        return {
          col: c.col,
          row: c.row,
          cell_type: orig?.cell_type ?? area.area_type,
          area_id: null,
          label: '',
          meta: orig?.meta || {},
          updated_at: ts,
        };
      }));
    }

    // Als de sub-area nu leeg is, verwijder hem.
    const cellsAfter = cellsStore.get();
    let stillUsed = false;
    for (const c of cellsAfter.values()) {
      if (c.area_id === area.id) { stillUsed = true; break; }
    }
    if (!stillUsed) {
      await deleteArea(area.id);
    }

    schedulePush();
    toast(`${subCells.length} cel${subCells.length === 1 ? '' : 'len'} verwijderd`);
    close();
  }

  function formatLastFilled(ts: number | undefined): string {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        timeZone: 'Europe/Amsterdam',
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
    }
  }

  async function saveLayout() {
    if (!area) return;
    await upsertArea({
      ...area,
      name: editName.trim(),
      color: editColor,
      updated_at: Date.now(),
    });
    schedulePush();
    toast('Vlak bijgewerkt');
    close();
  }

  async function saveContent() {
    const matVal = editMaterial.trim() || null;
    const qty = editQuantity ? Number(editQuantity) : null;
    const dt = editDate || null;
    const ts = Date.now();

    // Pending-modus: maak NU pas de sub-area óf voeg toe aan bestaande
    // (mergeIntoAreaId) i.p.v. een nieuwe area aan te maken.
    if (isPending) {
      const sel = pendingSel.value;
      if (!sel || sel.cells.length === 0) { close(); return; }

      let targetAreaId: number | string;
      if (sel.mergeIntoAreaId != null) {
        // Merge: voeg cellen toe aan bestaande sub-area + update metadata.
        const existing = areasStore.get().get(sel.mergeIntoAreaId);
        if (!existing) { close(); return; }
        await upsertArea({
          ...existing,
          material_name: matVal,
          color: matVal ? null : existing.color,
          metadata: { ...existing.metadata, quantity: qty, date: dt, lastFilled: ts },
          updated_at: ts,
        });
        targetAreaId = existing.id;
      } else {
        // Nieuw: maak nieuwe sub-area aan
        const newArea: AreaRow = {
          id: nextTempId(),
          name: '',
          area_type: sel.cells[0].cell_type,
          color: matVal ? null : (sel.parentColor || '#9A3412'),
          material_name: matVal,
          metadata: { quantity: qty, date: dt, lastFilled: ts },
          updated_at: ts,
        };
        await upsertArea(newArea);
        targetAreaId = newArea.id;
      }
      // Herwijs alle geselecteerde cellen naar de target area.
      await upsertCells(sel.cells.map((c) => ({
        col: c.col,
        row: c.row,
        cell_type: c.cell_type,
        area_id: targetAreaId,
        label: '',
        meta: {},
        updated_at: ts,
      })));
      if (matVal) {
        await setMaterialForArea(targetAreaId, matVal, currentPeriod.value);
      }
      schedulePush();
      toast(matVal ? `${matVal} · ${qty || '?'} partijen` : 'Vlak opgeslagen');
      close();
      return;
    }

    if (!area) return;
    await setMaterialForArea(area.id, matVal, currentPeriod.value);
    // Sla partijen en datum op in metadata.
    // Wis de custom color zodat de materiaal-kleur zichtbaar wordt.
    await upsertArea({
      ...area,
      material_name: matVal,
      color: matVal ? null : area.color,
      metadata: { ...area.metadata, quantity: qty, date: dt, lastFilled: ts },
      updated_at: ts,
    });
    schedulePush();
    toast(matVal ? `${matVal} · ${qty || '?'} partijen` : 'Materiaal gewist');
    close();
  }

  let confirmingDelete = $state(false);

  async function removeContent() {
    if (!area) return;

    // Bij zakken: wis alleen het materiaal, verwijder NIET de area
    if (area.area_type === 'zak') {
      await upsertArea({
        ...area,
        material_name: null,
        metadata: { ...area.metadata, quantity: null, date: null, lastFilled: null },
        updated_at: Date.now(),
      });
      schedulePush();
      toast('Materiaal verwijderd');
      close();
      return;
    }

    // Bij bunkers: geef cellen terug aan de parent bunker-area
    const cellsMap = cellsStore.get();
    const myCells = [...cellsMap.values()].filter(c => c.area_id === area.id);

    // Zoek buur-areas van hetzelfde cell_type (de grote bunker-area)
    const neighborAreaIds = new Map<number | string, number>();
    for (const c of myCells) {
      for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nb = cellsMap.get(`${c.col+dc},${c.row+dr}`);
        if (nb && nb.area_id != null && nb.area_id !== area.id && nb.cell_type === c.cell_type) {
          neighborAreaIds.set(nb.area_id, (neighborAreaIds.get(nb.area_id) || 0) + 1);
        }
      }
    }

    // Kies de buur-area met de meeste aangrenzende cellen
    let parentAreaId: number | string | null = null;
    let maxCount = 0;
    for (const [aid, cnt] of neighborAreaIds) {
      if (cnt > maxCount) { maxCount = cnt; parentAreaId = aid; }
    }

    const ts = Date.now();
    if (parentAreaId != null) {
      // Geef cellen terug aan de parent bunker-area
      await upsertCells(myCells.map(c => ({
        col: c.col, row: c.row,
        cell_type: c.cell_type,
        area_id: parentAreaId!,
        label: '',
        meta: c.meta || {},
        updated_at: ts,
      })));
    }

    // Verwijder de sub-area
    await deleteArea(area.id);
    schedulePush();
    toast('Balen-toewijzing verwijderd');
    close();
  }

  async function removeArea() {
    if (!area) return;
    if (!confirm(`Vlak "${area.name || 'naamloos'}" verwijderen?\n\nDe cellen blijven leeg.`)) return;
    await deleteArea(area.id);
    schedulePush();
    inspectorAreaId.set(null);
    toast('Vlak verwijderd');
  }

  // ── Splitsen — verdeel cellen in aparte connected components, elke krijgt nieuwe area ──
  async function splitArea() {
    if (!area) return;
    const myCells = [...cells.value.values()].filter((c) => c.area_id === area.id);
    if (myCells.length === 0) return;

    // Find connected components (4-connected)
    const cellSet = new Set(myCells.map((c) => `${c.col},${c.row}`));
    const visited = new Set<string>();
    const components: Array<typeof myCells> = [];
    for (const c of myCells) {
      const k = `${c.col},${c.row}`;
      if (visited.has(k)) continue;
      const comp: typeof myCells = [];
      const queue = [k];
      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const cell = myCells.find((mc) => `${mc.col},${mc.row}` === cur);
        if (!cell) continue;
        comp.push(cell);
        for (const nb of [`${cell.col - 1},${cell.row}`, `${cell.col + 1},${cell.row}`, `${cell.col},${cell.row - 1}`, `${cell.col},${cell.row + 1}`]) {
          if (cellSet.has(nb) && !visited.has(nb)) queue.push(nb);
        }
      }
      if (comp.length) components.push(comp);
    }

    if (components.length <= 1) {
      toast('Dit vlak is al één geheel');
      return;
    }

    // Eerste component houdt huidige area; rest krijgt nieuwe areas met (naam + #)
    for (let i = 1; i < components.length; i++) {
      const newArea = {
        id: nextTempId(),
        name: area.name ? `${area.name} #${i + 1}` : `Vlak ${i + 1}`,
        area_type: area.area_type,
        color: area.color,
        material_name: area.material_name,
        material_id: area.material_id,
        metadata: area.metadata,
        updated_at: Date.now(),
      };
      await upsertArea(newArea);
      const cellUpdates = components[i].map((c) => ({
        ...c, area_id: newArea.id, updated_at: Date.now(),
      }));
      await upsertCells(cellUpdates);
    }
    schedulePush();
    toast(`Opgesplitst in ${components.length} vlakken`);
    close();
  }
</script>

{#if showInspector}
  <div class="overlay" role="presentation">
    <div class="panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="head" style:background={headerColor}>
        <div class="drag-handle"></div>
        <div class="head-row">
          <div>
            <div class="hd-type">{headerType}</div>
            <div class="hd-name">{headerName}</div>
            <div class="hd-sub">
              {#if mode.value !== 'layout'}
                {#if !isPending && currentMaterial}
                  {currentMaterial} · {formatPeriod(currentPeriod.value)}
                {:else}
                  {formatPeriod(currentPeriod.value)}
                {/if}
              {/if}
            </div>
          </div>
          <button class="x" onclick={cancel}>×</button>
        </div>
      </div>

      <div class="body">
        <div class="row">
          <div class="kv"><span class="k">Cellen</span><span class="v">{cellCount}</span></div>
          {#if isSubSel}
            <div class="kv"><span class="k">Selectie</span><span class="v sel-cnt">{subSelCount}</span></div>
          {/if}
          {#if mode.value !== 'layout'}
            <div class="kv"><span class="k">Periode</span><span class="v">{formatPeriod(currentPeriod.value)}</span></div>
            {#if !isPending && currentMaterial}
              <div class="kv"><span class="k">Materiaal</span><span class="v mat">{currentMaterial}</span></div>
            {/if}
          {/if}
        </div>
        {#if !isPending && area?.metadata?.lastFilled}
          <div class="row">
            <div class="kv"><span class="k">Laatst gewijzigd</span><span class="v">{formatLastFilled(area.metadata.lastFilled)}</span></div>
          </div>
        {/if}

        {#if !isPending && mode.value === 'layout' && canEdit}
          <hr />
          <label>
            <span>Naam</span>
            <input type="text" bind:value={editName} placeholder="Naam van het vlak" />
          </label>
          <label>
            <span>Kleur</span>
            <input type="color" bind:value={editColor} />
          </label>
          <div class="actions">
            <button class="btn" onclick={splitArea}>↔ Splitsen</button>
            <button class="btn danger" onclick={removeArea}>🗑 Verwijderen</button>
            <button class="btn primary" onclick={saveLayout}>Opslaan</button>
          </div>
        {:else if mode.value === 'view' && canEdit && supportsMaterial}
          <hr />
          {#if !isPending && area?.area_type === 'zak'}
            <label>
              <span>Lijn / Materiaal</span>
            </label>
            <div class="line-buttons">
              {#each ['TL1', 'TL2', 'TL3', 'S01', 'S02', 'S03'] as line}
                <button
                  class="line-btn"
                  class:active={editMaterial === line}
                  onclick={() => { editMaterial = line; }}
                >{line}</button>
              {/each}
            </div>
          {:else}
            <label>
              <span>Materiaal</span>
              <MaterialPicker bind:value={editMaterial} showBaseName={true} />
            </label>
          {/if}
          <label>
            <span>Aantal partijen</span>
            <input type="number" bind:value={editQuantity} placeholder="Bijv. 12" min="0" />
          </label>
          <label>
            <span>Datum</span>
            <input type="date" bind:value={editDate} />
          </label>
          <div class="actions">
            {#if isPending}
              {#if confirmingDelete}
                <div class="confirm-row">
                  <span>Materiaal uit selectie verwijderen?</span>
                  <button class="btn danger" onclick={removePendingSelectionCells}>Ja</button>
                  <button class="btn" onclick={() => { confirmingDelete = false; }}>Nee</button>
                </div>
              {:else}
                <button class="btn danger" onclick={() => { confirmingDelete = true; }}>🗑 Verwijderen</button>
                <button class="btn primary" onclick={saveContent}>Opslaan</button>
              {/if}
            {:else if confirmingDelete}
              <div class="confirm-row">
                <span>{isSubSel ? `${subSelCount} cel${subSelCount === 1 ? '' : 'len'} verwijderen?` : 'Verwijderen?'}</span>
                <button
                  class="btn danger"
                  onclick={() => { isSubSel ? removeSubSelection() : removeContent(); }}
                >Ja</button>
                <button class="btn" onclick={() => { confirmingDelete = false; }}>Nee</button>
              </div>
            {:else if isSubSel}
              <button class="btn danger" onclick={() => { confirmingDelete = true; }}>
                🗑 Verwijder {subSelCount} cel{subSelCount === 1 ? '' : 'len'}
              </button>
              <button class="btn primary" onclick={saveContent}>Opslaan</button>
            {:else}
              <button class="btn danger" onclick={() => { confirmingDelete = true; }}>🗑 Verwijderen</button>
              <button class="btn primary" onclick={saveContent}>Opslaan</button>
            {/if}
          </div>
        {:else if !canEdit}
          <!-- Anonieme bezoeker: alleen-lezen — geen materiaal-keuze, geen knoppen -->
          <div class="readonly-note">Log in om wijzigingen te maken.</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1500;
    background: rgba(15,23,42,0.4);
    display: flex; align-items: flex-end; justify-content: center;
    padding: 0;
    backdrop-filter: blur(3px);
    animation: fadeIn .15s;
  }
  .panel {
    background: var(--bg-surface);
    width: 100%; max-width: 480px;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-4);
    overflow: hidden;
    animation: slideUp .2s cubic-bezier(.2,.9,.3,1);
    max-height: 90vh;
    display: flex; flex-direction: column;
  }
  @keyframes slideUp { from { transform: translateY(40px); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
  @media (min-width: 720px) {
    .overlay { align-items: center; padding: 20px; }
    .panel { border-radius: var(--radius-xl); }
  }

  .head {
    position: relative;
    padding: 14px 20px 16px;
    color: #fff;
    flex-shrink: 0;
  }
  .drag-handle {
    position: absolute;
    top: 6px; left: 50%;
    transform: translateX(-50%);
    width: 24px; height: 4px;
    background: rgba(255,255,255,0.4);
    border-radius: 2px;
  }
  .head-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 12px;
    margin-top: 6px;
  }
  .hd-type { font-size: var(--text-2xs); opacity: .85; text-transform: uppercase; letter-spacing: .5px; font-weight: 700; }
  .hd-name { font-size: var(--text-lg); font-weight: 700; margin-top: 2px; line-height: 1.15; }
  .hd-sub {
    font-size: var(--text-sm);
    margin-top: 4px;
    opacity: .9;
    font-weight: 600;
  }
  .x {
    background: rgba(255,255,255,0.2); border: 0;
    width: 32px; height: 32px; border-radius: 50%;
    color: #fff; font-size: 20px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .x:hover { background: rgba(255,255,255,0.3); }

  .body {
    padding: 18px 20px 22px;
    overflow-y: auto;
    flex: 1;
  }
  .row { display: flex; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
  .kv { display: flex; flex-direction: column; }
  .k { font-size: var(--text-2xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; }
  .v { font-size: var(--text-sm); font-weight: 700; color: var(--text-primary); margin-top: 2px; }
  .v.mat { color: var(--accent-primary); }
  .v.sel-cnt { color: #c0392b; }

  hr { border: 0; border-top: 1px solid var(--border-subtle); margin: 14px 0; }
  label { display: block; margin-bottom: 12px; }
  label > span { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
  label input[type="text"] { width: 100%; padding: 9px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: var(--text-sm); background: var(--bg-sunken); outline: none; }
  label input[type="text"]:focus { border-color: var(--accent-primary); background: var(--bg-surface); }
  label input[type="number"] { width: 100%; padding: 9px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: var(--text-sm); background: var(--bg-sunken); outline: none; }
  label input[type="number"]:focus { border-color: var(--accent-primary); background: var(--bg-surface); }
  label input[type="date"] { width: 100%; padding: 9px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: var(--text-sm); background: var(--bg-sunken); outline: none; }
  label input[type="date"]:focus { border-color: var(--accent-primary); background: var(--bg-surface); }
  label input[type="color"] { width: 60px; height: 32px; padding: 2px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); }

  .check-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px;
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 600;
  }
  .check-row input[type="checkbox"] {
    width: 18px; height: 18px; cursor: pointer;
    accent-color: var(--mode-content);
  }
  .check-row > span { display: inline; }

  .actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .actions .btn { flex: 1; min-width: 90px; min-height: 44px; }
  .confirm-row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    font-size: var(--text-sm); font-weight: 700; color: var(--text-primary);
  }
  .confirm-row span { flex: 1; }
  .confirm-row .btn { min-width: 60px; min-height: 40px; }
  .readonly-note { margin-top: 14px; padding: 10px 12px; background: var(--bg-sunken); border-radius: var(--radius-md); font-size: var(--text-xs); color: var(--text-tertiary); text-align: center; }

  .line-buttons {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .line-btn {
    padding: 12px 8px;
    border: 2px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-sunken);
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    min-height: 44px;
  }
  .line-btn:hover { border-color: var(--accent-primary); background: var(--bg-surface); }
  .line-btn.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;
  }
</style>
