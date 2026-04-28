<script lang="ts">
  import {
    paintToolStore,
    zakOrientationStore,
    zakRijNumStore,
    toast,
    type PaintTool,
  } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';
  import { cellsStore, deleteCells } from '../../stores/state';
  import { schedulePush } from '../../sync/engine';
  import SectionCard from './SectionCard.svelte';

  const paint = useStore(paintToolStore);
  const zakOrient = useStore(zakOrientationStore);
  const zakRijNum = useStore(zakRijNumStore);

  function setTool(t: PaintTool) {
    // Toggle: als deze tool al actief is, deselecteer (set naar 'none').
    if (paint.value.type === t.type) {
      paintToolStore.set({ type: 'none' });
    } else {
      paintToolStore.set(t);
    }
  }
  function isActive(type: string) { return paint.value.type === type; }

  function setRijNum(v: number) {
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > 999) v = 999;
    zakRijNumStore.set(Math.floor(v));
  }
  function bumpRij(delta: number) { setRijNum(zakRijNum.value + delta); }

  async function cleanupOrphanNumbering() {
    const orphans: Array<{ col: number; row: number }> = [];
    for (const c of cellsStore.get().values()) {
      if (c.cell_type === 'zak-num') orphans.push({ col: c.col, row: c.row });
    }
    if (!orphans.length) { toast('Geen losse nummering-cellen gevonden'); return; }
    if (!confirm(`Wis ALLE ${orphans.length} losse nummering-cellen? (Zakken zelf blijven staan)`)) return;
    await deleteCells(orphans);
    schedulePush();
    toast(`${orphans.length} nummering-cellen gewist`);
  }
</script>

<!-- ─── Plaatsen ─── -->
<SectionCard title="Zak plaatsen">
  <button
    class="zak-place-btn"
    class:active={isActive('zak')}
    aria-pressed={isActive('zak')}
    onclick={() => setTool({ type: 'zak' })}
  >
    <span class="zak-icon">
      <span class="zak-grid-mini">
        <span></span><span></span>
        <span></span><span></span>
      </span>
    </span>
    <span class="zak-place-info">
      <span class="zak-place-title">Zak-positie</span>
      <span class="zak-place-sub">2 × 2 cellen</span>
    </span>
  </button>

  <div class="orient-section">
    <span class="orient-label">Nummering richting</span>
    <div class="orient-row">
      <button
        class="orient-btn"
        class:active={zakOrient.value === 'h'}
        onclick={() => zakOrientationStore.set('h')}
      >
        <span class="orient-icon">↔</span>
        <span>Horizontaal</span>
      </button>
      <button
        class="orient-btn"
        class:active={zakOrient.value === 'v'}
        onclick={() => zakOrientationStore.set('v')}
      >
        <span class="orient-icon">↕</span>
        <span>Verticaal</span>
      </button>
    </div>
  </div>

  <div class="rij-section">
    <span class="rij-label">Rij nummer</span>
    <div class="rij-row">
      <button class="rij-step" onclick={() => bumpRij(-1)} title="Vorige" aria-label="Vorige rij">−</button>
      <input
        class="rij-input tnum"
        type="number"
        min="0"
        max="999"
        value={zakRijNum.value}
        oninput={(e) => setRijNum(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <button class="rij-step" onclick={() => bumpRij(1)} title="Volgende" aria-label="Volgende rij">+</button>
    </div>
    <span class="rij-hint">
      {#if zakRijNum.value > 0}
        De volgende geplaatste zakken worden <strong>Rij {zakRijNum.value}</strong>.
      {:else}
        Zakken worden geplaatst <strong>zonder rij-nummer</strong>.
      {/if}
    </span>
  </div>
</SectionCard>

<style>
  /* ─── Zak plaatsen ─── */
  .zak-place-btn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 56px;
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
  }
  .zak-place-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .zak-place-btn.active {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.15);
  }
  .zak-icon {
    width: 36px;
    height: 36px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .zak-place-btn.active .zak-icon {
    background: rgba(194, 84, 10, 0.12);
    border-color: var(--mode-layout);
  }
  .zak-grid-mini {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    width: 18px;
    height: 18px;
  }
  .zak-grid-mini span {
    background: var(--border-strong);
    border-radius: 1px;
  }
  .zak-place-btn.active .zak-grid-mini span {
    background: var(--mode-layout);
  }
  .zak-place-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
  }
  .zak-place-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .zak-place-btn.active .zak-place-title {
    color: var(--mode-layout);
  }
  .zak-place-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* ─── Oriëntatie ─── */
  .orient-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .orient-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .orient-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .orient-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 44px;
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .15s ease;
  }
  .orient-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .orient-btn.active {
    background: var(--mode-layout);
    border-color: var(--mode-layout);
    color: #fff;
    box-shadow: 0 2px 6px rgba(194, 84, 10, 0.25);
  }
  .orient-icon {
    font-size: 15px;
  }

  /* ─── Rij-nummer input ─── */
  .rij-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .rij-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .rij-row {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    gap: var(--space-2);
    align-items: stretch;
  }
  .rij-step {
    height: 44px;
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .12s ease;
    line-height: 1;
  }
  .rij-step:hover {
    background: var(--bg-sunken);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
  }
  .rij-step:active {
    transform: scale(0.96);
  }
  .rij-input {
    height: 44px;
    border: 1.5px solid var(--border-subtle);
    background: var(--bg-sunken);
    border-radius: var(--radius-md);
    padding: 0 var(--space-3);
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    text-align: center;
    outline: none;
    transition: border-color .12s, background .12s;
    -moz-appearance: textfield;
  }
  .rij-input::-webkit-outer-spin-button,
  .rij-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .rij-input:focus {
    border-color: var(--mode-layout);
    background: var(--bg-surface);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.1);
  }
  .rij-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.35;
    margin-top: 2px;
  }
  .rij-hint strong {
    color: var(--mode-layout);
    font-weight: 700;
  }

  /* ─── Onderhoud ─── */
  .maint-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
  .maint-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
    min-height: 56px;
    justify-content: center;
  }
  .maint-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-1);
  }
  .maint-btn:active {
    transform: translateY(0);
  }
  .maint-icon {
    font-size: 18px;
    line-height: 1;
  }
  .maint-text {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
    line-height: 1.2;
  }
</style>
