<script lang="ts">
  import { cellsStore, areasStore } from '../stores/state';
  import { schedulePush } from '../sync/engine';
  import { toast } from '../stores/ui';
  import { useStore } from '../useStore.svelte';
  import RijPickerSlot from './RijPickerSlot.svelte';
  import { currentPeriodStore, setMaterialForArea, formatPeriod } from '../stores/period';

  interface Slot {
    label: string;
    rij: string;
    materialName: string;
  }

  const STORAGE_KEY = 'yard_rij_picker_slots';
  const MAX_SLOTS = 4;
  const DEFAULT_SLOTS: Slot[] = [
    { label: 'TL1', rij: '', materialName: '' },
    { label: 'TL2', rij: '', materialName: '' },
  ];

  function loadSlots(): Slot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [...DEFAULT_SLOTS];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((s: any) => ({
          label: String(s.label || 'TL'),
          rij: String(s.rij || ''),
          materialName: String(s.materialName || ''),
        })).slice(0, MAX_SLOTS);
      }
    } catch {}
    return [...DEFAULT_SLOTS];
  }

  function saveSlots(s: Slot[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }

  let slots = $state<Slot[]>(loadSlots());
  let appliedFlash = $state<Record<number, boolean>>({});

  // Persist any change
  $effect(() => {
    // Read everything to register dependencies
    const snapshot = slots.map((s) => ({ ...s }));
    saveSlots(snapshot);
  });

  const cells = useStore(cellsStore);
  const areas = useStore(areasStore);
  const currentPeriod = useStore(currentPeriodStore);

  // Year list voor periode-dropdown: vorig, huidig, volgend jaar × Q1..Q4
  const periodOptions = $derived.by(() => {
    const now = new Date();
    const y = now.getFullYear();
    const out: string[] = [];
    for (const yr of [y - 1, y, y + 1]) {
      for (let q = 1; q <= 4; q++) out.push(`${yr}-Q${q}`);
    }
    return out;
  });

  function onPeriodChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v) currentPeriodStore.set(v);
  }

  // Derive unique zak rijen from cellsStore.
  // Zak cells store rij identity in meta.zakRij (preferred) or meta.zakNum (auto-num fallback).
  const rijenInfo = $derived.by(() => {
    const map = new Map<string, number>();
    for (const c of cells.value.values()) {
      if (c.cell_type !== 'zak') continue;
      // Only count anchors so 1 zak-position = 1 count
      if (!c.meta?.zakAnchor) continue;
      const r = c.meta?.zakRij ?? c.meta?.zakNum;
      if (r === undefined || r === null || r === '') continue;
      const key = String(r);
      map.set(key, (map.get(key) || 0) + 1);
    }
    const arr = [...map.entries()];
    arr.sort((a, b) => {
      const an = Number(a[0]);
      const bn = Number(b[0]);
      const aIsNum = !isNaN(an);
      const bIsNum = !isNaN(bn);
      if (aIsNum && bIsNum) return an - bn;
      if (aIsNum) return -1;
      if (bIsNum) return 1;
      return a[0].localeCompare(b[0]);
    });
    return arr;
  });

  function renameSlot(idx: number) {
    const cur = slots[idx].label;
    const nxt = prompt('Naam voor dit slot:', cur);
    if (nxt && nxt.trim()) {
      slots[idx].label = nxt.trim().slice(0, 16);
    }
  }

  function addSlot() {
    if (slots.length >= MAX_SLOTS) return;
    slots = [...slots, { label: `TL${slots.length + 1}`, rij: '', materialName: '' }];
  }

  function removeSlot(idx: number) {
    if (slots.length <= 1) return;
    slots = slots.filter((_, i) => i !== idx);
  }

  async function applySlot(idx: number) {
    const slot = slots[idx];
    if (!slot.rij || !slot.materialName) return;

    const cellsMap = cells.value;
    const areaIds = new Set<number | string>();
    let count = 0;
    for (const c of cellsMap.values()) {
      if (c.cell_type !== 'zak') continue;
      if (!c.meta?.zakAnchor) continue;
      const r = c.meta?.zakRij ?? c.meta?.zakNum;
      if (r === undefined || r === null) continue;
      if (String(r) !== slot.rij) continue;
      count++;
      if (c.area_id != null) areaIds.add(c.area_id);
    }

    if (count === 0) {
      toast(`Rij ${slot.rij} — geen posities gevonden`);
      return;
    }

    if (areaIds.size === 0) {
      toast(`Rij ${slot.rij} heeft geen vlak — koppel eerst aan een vlak`);
      return;
    }

    const period = currentPeriod.value;
    for (const aid of areaIds) {
      await setMaterialForArea(aid, slot.materialName, period);
    }
    schedulePush();
    toast(`Rij ${slot.rij} — ${count} posities op ${slot.materialName} gezet (${formatPeriod(period)})`);

    appliedFlash[idx] = true;
    setTimeout(() => { appliedFlash[idx] = false; }, 1200);
  }
</script>

<div class="rij-picker-row">
  <span class="rp-rowlabel">Actieve rij(en)</span>

  {#if rijenInfo.length === 0}
    <div class="rp-hint">Plaats eerst zakken in Indeling-modus.</div>
  {:else}
    <div class="rp-slots">
      {#each slots as slot, i (i)}
        <RijPickerSlot
          bind:slot={slots[i]}
          rijenInfo={rijenInfo}
          canRemove={slots.length > 1}
          applied={!!appliedFlash[i]}
          canApply={!!slot.rij && !!slot.materialName}
          onRename={() => renameSlot(i)}
          onRemove={() => removeSlot(i)}
          onApply={() => applySlot(i)}
        />
      {/each}

      {#if slots.length < MAX_SLOTS}
        <button class="rp-add" onclick={addSlot} title="Voeg een slot toe">+ rij</button>
      {/if}
    </div>
  {/if}

  <div class="rp-period">
    <span class="rp-period-label">Periode</span>
    <select class="rp-period-select tnum" value={currentPeriod.value} onchange={onPeriodChange}>
      {#each periodOptions as p (p)}
        <option value={p}>{formatPeriod(p)}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .rij-picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-4);
    height: 100%;
    font-feature-settings: "tnum";
  }
  .rp-rowlabel {
    font-size: var(--text-2xs);
    line-height: var(--text-2xs-line);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    white-space: nowrap;
  }
  .rp-hint {
    height: 36px;
    display: flex; align-items: center;
    padding: 0 var(--space-3);
    background: var(--bg-sunken);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .rp-slots {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }

  .rp-add {
    height: 36px;
    padding: 0 var(--space-3);
    background: var(--bg-sunken);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
  }
  .rp-add:hover { background: var(--bg-surface); border-color: var(--mode-content); color: var(--mode-content); }

  .rp-period {
    display: flex; flex-direction: column;
    gap: 4px;
    margin-left: auto;
    padding-right: var(--space-2);
  }
  .rp-period-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .rp-period-select {
    height: 36px;
    min-width: 120px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .rp-period-select:focus { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
</style>
