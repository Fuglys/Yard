<script lang="ts">
  import { areasStore, cellsStore, upsertArea, deleteArea, upsertCells, nextTempId } from '../stores/state';
  import { inspectorAreaId, modeStore, authStore, toast } from '../stores/ui';
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

  const area = $derived(inspector.value != null ? areas.value.get(inspector.value) : null);
  const canEdit = $derived(auth.value?.role === 'admin' || auth.value?.role === 'supervisor');
  // Materiaal-keuze is alleen logisch voor zak/bunker/custom — niet voor wall/container/afval
  const supportsMaterial = $derived(area && ['zak', 'bunker', 'custom'].includes(area.area_type));

  let editName = $state('');
  let editMaterial = $state('');
  let editColor = $state('#e67e22');
  let applyToFuture = $state(false);

  // Cache laatst-bewerkte area-id zodat we materiaal niet pakken voordat 'area' update is
  let lastSeenId: number | string | null = null;
  $effect(() => {
    if (area && area.id !== lastSeenId) {
      lastSeenId = area.id;
      editName = area.name || '';
      editColor = area.color || '#e67e22';
      applyToFuture = false;
    }
    if (!area) lastSeenId = null;
  });
  // Materiaal: synchroniseer met current period whenever area or period changes
  $effect(() => {
    if (!area) return;
    const m = getMaterialForAreaInPeriod(area, currentPeriod.value);
    editMaterial = m || '';
  });

  const currentMaterial = $derived(area ? getMaterialForAreaInPeriod(area, currentPeriod.value) : null);

  function close() { inspectorAreaId.set(null); }

  function formatLastFilled(ts: number | undefined): string {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(ts));
    } catch {
      const d = new Date(ts);
      return d.toLocaleString('nl-NL');
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
  }

  async function saveContent() {
    if (!area) return;
    const matVal = editMaterial.trim() || null;
    await setMaterialForArea(area.id, matVal, currentPeriod.value);
    if (applyToFuture) {
      const future = laterQuartersInYear(currentPeriod.value);
      for (const p of future) {
        await setMaterialForArea(area.id, matVal, p);
      }
      if (future.length) {
        toast(`Toegepast op ${currentPeriod.value} + ${future.length} latere periode(n)`);
      } else {
        toast('Vlak bijgewerkt');
      }
    } else {
      toast('Vlak bijgewerkt');
    }
    schedulePush();
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

{#if area}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="head" style:background={area.color || '#2c3e50'}>
        <div class="drag-handle"></div>
        <div class="head-row">
          <div>
            <div class="hd-type">{area.area_type}</div>
            <div class="hd-name">{area.name || 'Naamloos vlak'}</div>
            <div class="hd-sub">
              {#if currentMaterial}
                {currentMaterial} · {formatPeriod(currentPeriod.value)}
              {:else}
                {formatPeriod(currentPeriod.value)}
              {/if}
            </div>
          </div>
          <button class="x" onclick={close}>×</button>
        </div>
      </div>

      <div class="body">
        <div class="row">
          <div class="kv"><span class="k">Cellen</span><span class="v">{[...cells.value.values()].filter((c) => c.area_id === area.id).length}</span></div>
          <div class="kv"><span class="k">Periode</span><span class="v">{formatPeriod(currentPeriod.value)}</span></div>
          {#if currentMaterial}
            <div class="kv"><span class="k">Materiaal</span><span class="v mat">{currentMaterial}</span></div>
          {/if}
        </div>
        {#if area.metadata?.lastFilled}
          <div class="row">
            <div class="kv"><span class="k">Laatst gewijzigd</span><span class="v">{formatLastFilled(area.metadata.lastFilled)}</span></div>
          </div>
        {/if}

        {#if mode.value === 'layout' && canEdit}
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
          <label>
            <span>Materiaal in dit vlak</span>
            <MaterialPicker bind:value={editMaterial} />
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={applyToFuture} />
            <span>Voor alle volgende perioden ook toepassen</span>
          </label>
          <div class="actions">
            <button class="btn primary" onclick={saveContent}>Opslaan</button>
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
    max-height: 80vh;
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

  hr { border: 0; border-top: 1px solid var(--border-subtle); margin: 14px 0; }
  label { display: block; margin-bottom: 12px; }
  label > span { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
  label input[type="text"] { width: 100%; padding: 9px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: var(--text-sm); background: var(--bg-sunken); outline: none; }
  label input[type="text"]:focus { border-color: var(--accent-primary); background: var(--bg-surface); }
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
  .readonly-note { margin-top: 14px; padding: 10px 12px; background: var(--bg-sunken); border-radius: var(--radius-md); font-size: var(--text-xs); color: var(--text-tertiary); text-align: center; }
</style>
