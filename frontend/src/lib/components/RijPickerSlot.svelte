<script lang="ts">
  import MaterialPicker from './MaterialPicker.svelte';

  let {
    slot = $bindable(),
    rijenInfo,
    canRemove,
    applied,
    canApply,
    onRename,
    onRemove,
    onApply,
  } = $props<{
    slot: { label: string; rij: string; materialName: string };
    rijenInfo: Array<[string, number]>;
    canRemove: boolean;
    applied: boolean;
    canApply: boolean;
    onRename: () => void;
    onRemove: () => void;
    onApply: () => void;
  }>();

  const cnt = $derived.by(() => {
    const f = rijenInfo.find(([r]: [string, number]) => r === slot.rij);
    return f ? f[1] : 0;
  });

  // Sync MaterialPicker (uses bind:value) with slot.materialName
  let materialName = $state(slot.materialName);

  // Push internal -> external
  $effect(() => {
    if (materialName !== slot.materialName) {
      slot.materialName = materialName;
    }
  });
  // Pull external -> internal (e.g. localStorage hydration)
  $effect(() => {
    if (slot.materialName !== materialName) {
      materialName = slot.materialName;
    }
  });

  function onRijChange(e: Event) {
    slot.rij = (e.currentTarget as HTMLSelectElement).value;
  }
</script>

<div class="rp-card">
  <div class="rp-left">
    <div class="rp-slot-head">
      <button class="rp-slot-label" onclick={onRename} title="Klik om te hernoemen">
        {slot.label}
      </button>
      {#if canRemove}
        <button class="rp-x" onclick={onRemove} title="Slot verwijderen">✕</button>
      {/if}
    </div>
    <label class="rp-rij-label">
      <span>Rij</span>
      <select class="rp-rij tnum" value={slot.rij} onchange={onRijChange}>
        <option value="">—</option>
        {#each rijenInfo as [rij, _c] (rij)}
          <option value={rij}>{rij}</option>
        {/each}
      </select>
    </label>
    <div class="rp-count tnum">{slot.rij ? `${cnt} posities` : '—'}</div>
  </div>

  <div class="rp-right">
    <div class="rp-mp-wrap">
      <MaterialPicker bind:value={materialName} placeholder="Selecteer materiaal…" />
    </div>
    <button
      class="rp-apply"
      class:applied
      disabled={!canApply}
      onclick={onApply}
    >
      {applied ? '✓ Toegepast' : '▤ Toepassen op rij'}
    </button>
  </div>
</div>

<style>
  .rp-card {
    display: flex;
    width: 360px;
    height: 96px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    overflow: hidden;
  }
  .rp-left {
    width: 130px;
    flex-shrink: 0;
    padding: var(--space-2) var(--space-3);
    border-right: 1px solid var(--border-subtle);
    display: flex; flex-direction: column;
    gap: 4px;
  }
  .rp-slot-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .rp-slot-label {
    background: transparent;
    border: 0;
    padding: 0;
    font-size: var(--text-md);
    line-height: 1.1;
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .rp-slot-label:hover { color: var(--mode-content); }
  .rp-x {
    background: transparent;
    border: 0;
    color: var(--text-tertiary);
    font-size: 11px;
    width: 18px; height: 18px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
  }
  .rp-x:hover { background: var(--bg-sunken); color: var(--accent-danger); }
  .rp-rij-label {
    display: flex; align-items: center; gap: 6px;
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .rp-rij {
    flex: 1;
    height: 28px;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    padding: 0 6px;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .rp-rij:focus { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
  .rp-count {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: 600;
  }

  .rp-right {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    display: flex; flex-direction: column;
    gap: var(--space-2);
    justify-content: center;
  }
  .rp-mp-wrap :global(.mp), .rp-mp-wrap :global(.mp-trigger) { width: 100%; }
  .rp-mp-wrap :global(.mp-trigger) {
    height: 36px; min-width: 0;
    border-radius: var(--radius-md);
  }
  .rp-apply {
    height: 36px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--mode-content);
    color: #fff;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    transition: background .12s, transform .08s;
  }
  .rp-apply:hover:not(:disabled) { background: #166934; }
  .rp-apply:active:not(:disabled) { transform: translateY(1px); }
  .rp-apply:disabled { opacity: .45; cursor: not-allowed; }
  .rp-apply.applied { background: var(--accent-success); }
</style>
