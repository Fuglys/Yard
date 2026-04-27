<script lang="ts">
  import { areasStore, cellsStore } from '../stores/state';
  import { useStore } from '../useStore.svelte';
  import { bulkDrawerOpen, toast } from '../stores/ui';
  import { currentPeriodStore, formatPeriod, getMaterialForAreaInPeriod, setMaterialForArea } from '../stores/period';
  import { schedulePush } from '../sync/engine';
  import MaterialPicker from './MaterialPicker.svelte';

  const open = useStore(bulkDrawerOpen);
  const areas = useStore(areasStore);
  const cells = useStore(cellsStore);
  const currentPeriod = useStore(currentPeriodStore);

  let period = $state(currentPeriod.value);
  let fromMat = $state('');
  let toMat = $state('');
  let scope = $state<'all' | 'zak' | 'bunker'>('all');

  // When drawer opens, sync period to current
  $effect(() => {
    if (open.value) {
      period = currentPeriod.value;
      fromMat = '';
      toMat = '';
      scope = 'all';
    }
  });

  // Period options: vorig + huidig + volgend jaar × Q1..Q4
  const periodOptions = $derived.by(() => {
    const now = new Date();
    const y = now.getFullYear();
    const out: string[] = [];
    for (const yr of [y - 1, y, y + 1]) {
      for (let q = 1; q <= 4; q++) out.push(`${yr}-Q${q}`);
    }
    return out;
  });

  // Verzamel areas die getroffen worden door huidige selectie
  const targetAreas = $derived.by(() => {
    if (!fromMat) return [] as { id: number | string; name: string }[];
    const areasMap = areas.value;
    const cellsMap = cells.value;

    // Bereken set van area-ids die in scope vallen
    const scopeAreaIds = new Set<number | string>();
    if (scope === 'all' || scope === 'zak') {
      // Areas die zak-cellen bevatten
      for (const c of cellsMap.values()) {
        if (c.cell_type === 'zak' && c.meta?.zakAnchor && c.area_id != null) {
          scopeAreaIds.add(c.area_id);
        }
      }
    }
    if (scope === 'all' || scope === 'bunker') {
      for (const a of areasMap.values()) {
        if (a.area_type === 'bunker') scopeAreaIds.add(a.id);
      }
    }
    if (scope === 'all') {
      // Voeg ook custom toe
      for (const a of areasMap.values()) {
        if (a.area_type === 'custom') scopeAreaIds.add(a.id);
      }
    }

    const out: { id: number | string; name: string }[] = [];
    for (const aid of scopeAreaIds) {
      const a = areasMap.get(aid);
      if (!a) continue;
      const cur = getMaterialForAreaInPeriod(a, period);
      if (cur === fromMat) {
        out.push({ id: a.id, name: a.name || `Vlak ${a.id}` });
      }
    }
    return out;
  });

  function close() { bulkDrawerOpen.set(false); }

  async function apply() {
    if (!fromMat) {
      toast('Kies eerst een bron-materiaal');
      return;
    }
    const targets = targetAreas;
    if (targets.length === 0) {
      toast('Geen vlakken om te wijzigen');
      return;
    }
    const newVal = (toMat || '').trim() || null;
    for (const t of targets) {
      await setMaterialForArea(t.id, newVal, period);
    }
    schedulePush();
    toast(`${targets.length} vlakken aangepast (${formatPeriod(period)})`);
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open.value) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if open.value}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="drawer" role="dialog" aria-modal="true" aria-label="Bulk hertoewijzen" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <div class="title">Bulk hertoewijzen</div>
        <button class="x" onclick={close}>×</button>
      </div>
      <div class="body">
        <label class="field">
          <span>Periode</span>
          <select class="ctl tnum" bind:value={period}>
            {#each periodOptions as p (p)}
              <option value={p}>{formatPeriod(p)}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Vervang</span>
          <MaterialPicker bind:value={fromMat} placeholder="Bron-materiaal…" />
        </label>

        <label class="field">
          <span>Door</span>
          <MaterialPicker bind:value={toMat} placeholder="Doel-materiaal (leeg = wissen)" />
        </label>

        <fieldset class="field scope-field">
          <legend>Bereik</legend>
          <label class="radio"><input type="radio" name="scope" value="all" bind:group={scope} /> Alle vlakken</label>
          <label class="radio"><input type="radio" name="scope" value="zak" bind:group={scope} /> Alleen zak-rijen</label>
          <label class="radio"><input type="radio" name="scope" value="bunker" bind:group={scope} /> Alleen bunkers</label>
        </fieldset>

        <div class="preview tnum" class:has-targets={targetAreas.length > 0}>
          {targetAreas.length} vlakken aangepast
        </div>
      </div>
      <div class="foot">
        <button class="btn ghost" onclick={close}>Annuleren</button>
        <button class="btn primary" onclick={apply} disabled={targetAreas.length === 0}>Toepassen</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1600;
    background: rgba(15,23,42,0.4);
    display: flex; justify-content: flex-end;
    backdrop-filter: blur(3px);
    animation: fadeIn .15s;
  }
  .drawer {
    width: 100%; max-width: 420px;
    background: var(--bg-surface);
    box-shadow: var(--shadow-4);
    display: flex; flex-direction: column;
    animation: slideRight .22s cubic-bezier(.2,.9,.3,1);
  }
  @keyframes slideRight {
    from { transform: translateX(40px); opacity: .5; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  .head {
    display: flex; justify-content: space-between; align-items: center;
    padding: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-sunken);
  }
  .title {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }
  .x {
    background: transparent; border: 0;
    width: 36px; height: 36px;
    border-radius: 50%;
    font-size: 22px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .x:hover { background: var(--bg-surface); }

  .body {
    padding: var(--space-4);
    overflow-y: auto;
    flex: 1;
    display: flex; flex-direction: column;
    gap: var(--space-3);
  }
  .field {
    display: flex; flex-direction: column;
    gap: 4px;
  }
  .field > span, .field legend {
    font-size: var(--text-2xs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 0;
  }
  .ctl {
    height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .field :global(.mp), .field :global(.mp-trigger) { width: 100%; }
  .field :global(.mp-trigger) {
    height: 40px; min-width: 0;
    border-radius: var(--radius-md);
  }

  .scope-field {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    margin: 0;
    display: flex; flex-direction: column;
    gap: var(--space-1);
  }
  .radio {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 600;
    cursor: pointer;
    min-height: 36px;
  }
  .radio input[type="radio"] {
    width: 18px; height: 18px;
    accent-color: var(--mode-content);
    cursor: pointer;
  }

  .preview {
    padding: var(--space-3);
    background: var(--bg-sunken);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-tertiary);
    text-align: center;
  }
  .preview.has-targets {
    color: var(--mode-content);
    border-color: var(--mode-content);
    background: rgba(30,132,73,0.08);
  }

  .foot {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-subtle);
    display: flex; gap: var(--space-2); justify-content: flex-end;
  }
  .btn {
    height: 44px;
    padding: 0 var(--space-4);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
    color: var(--text-secondary);
  }
  .btn.ghost:hover { background: var(--bg-sunken); }
  .btn.primary {
    background: var(--mode-content);
    color: #fff;
    border-color: var(--mode-content);
  }
  .btn.primary:hover:not(:disabled) { background: #166934; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }

  @media (max-width: 720px) {
    .drawer { max-width: 100%; }
  }
</style>
