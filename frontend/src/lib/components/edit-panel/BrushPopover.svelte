<script lang="ts">
  import { brushSizeStore } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';

  let { open = $bindable(false) } = $props<{ open: boolean }>();

  const brush = useStore(brushSizeStore);

  function setBrush(w: number, h: number) {
    brushSizeStore.set({ w: Math.max(1, Math.min(20, w)), h: Math.max(1, Math.min(20, h)) });
  }
  function setSquare(n: number) { setBrush(n, n); }
  function makeSquare() { setBrush(brush.value.w, brush.value.w); }

  function close() { open = false; }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="bp-backdrop" onclick={close} role="presentation"></div>
  <div
    class="bp"
    role="dialog"
    aria-label="Penseelgrootte"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') close(); }}
  >
    <div class="bp-head">
      <h4>Penseelgrootte</h4>
      <button class="bp-close" onclick={close} title="Sluiten">✕</button>
    </div>

    <div class="bp-hero">
      <div
        class="bp-grid"
        style="grid-template-columns: repeat({Math.min(brush.value.w, 8)}, 1fr); grid-template-rows: repeat({Math.min(brush.value.h, 8)}, 1fr);"
      >
        {#each Array(Math.min(brush.value.w, 8) * Math.min(brush.value.h, 8)) as _, i (i)}
          <div class="bp-cell"></div>
        {/each}
      </div>
      <div class="bp-meta">
        <div class="bp-dim tnum">{brush.value.w} × {brush.value.h}</div>
        <div class="bp-cells tnum">{brush.value.w * brush.value.h} cellen</div>
      </div>
    </div>

    <div class="bp-row">
      <span class="bp-row-label">Breed</span>
      <button class="bp-step" onclick={() => setBrush(brush.value.w - 1, brush.value.h)} disabled={brush.value.w <= 1}>−</button>
      <input
        class="tnum"
        type="number" min="1" max="20" value={brush.value.w}
        oninput={(e) => setBrush(parseInt((e.currentTarget as HTMLInputElement).value || '1'), brush.value.h)}
      />
      <button class="bp-step" onclick={() => setBrush(brush.value.w + 1, brush.value.h)} disabled={brush.value.w >= 20}>+</button>
    </div>
    <div class="bp-row">
      <span class="bp-row-label">Hoog</span>
      <button class="bp-step" onclick={() => setBrush(brush.value.w, brush.value.h - 1)} disabled={brush.value.h <= 1}>−</button>
      <input
        class="tnum"
        type="number" min="1" max="20" value={brush.value.h}
        oninput={(e) => setBrush(brush.value.w, parseInt((e.currentTarget as HTMLInputElement).value || '1'))}
      />
      <button class="bp-step" onclick={() => setBrush(brush.value.w, brush.value.h + 1)} disabled={brush.value.h >= 20}>+</button>
    </div>

    <div class="bp-presets">
      <button class:active={brush.value.w === 1 && brush.value.h === 1} onclick={() => setSquare(1)}>1×1</button>
      <button class:active={brush.value.w === 2 && brush.value.h === 2} onclick={() => setSquare(2)}>2×2</button>
      <button class:active={brush.value.w === 3 && brush.value.h === 3} onclick={() => setSquare(3)}>3×3</button>
      <button class:active={brush.value.w === 5 && brush.value.h === 5} onclick={() => setSquare(5)}>5×5</button>
    </div>
    <div class="bp-presets">
      <button onclick={() => setBrush(brush.value.w, 1)}>↔</button>
      <button onclick={() => setBrush(1, brush.value.h)}>↕</button>
      <button onclick={makeSquare}>■</button>
    </div>
  </div>
{/if}

<style>
  .bp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 600;
    background: transparent;
  }
  .bp {
    position: fixed;
    z-index: 601;
    width: 280px;
    height: 320px;
    right: 24px;
    bottom: 88px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-3);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    animation: bpIn 160ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
    transform-origin: bottom right;
  }
  @keyframes bpIn {
    from { opacity: 0; transform: translateY(8px) scale(.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .bp-head { display: flex; align-items: center; justify-content: space-between; }
  .bp-head h4 {
    font-size: var(--text-xs);
    line-height: var(--text-xs-line);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 700;
  }
  .bp-close {
    background: transparent; border: 0; color: var(--text-tertiary);
    width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
  }
  .bp-close:hover { background: var(--bg-sunken); color: var(--text-primary); }

  .bp-hero {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }
  .bp-grid {
    display: grid;
    gap: 2px;
    width: 72px; height: 72px;
    padding: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .bp-cell {
    background: linear-gradient(135deg, var(--mode-layout), #8b3a06);
    border-radius: 2px;
  }
  .bp-meta { display: flex; flex-direction: column; gap: 2px; }
  .bp-dim { font-size: var(--text-lg); font-weight: 800; color: var(--text-primary); line-height: 1; }
  .bp-cells { font-size: var(--text-xs); color: var(--text-tertiary); font-weight: 600; }

  .bp-row {
    display: flex; align-items: center; gap: 6px;
    height: 36px;
  }
  .bp-row-label {
    width: 48px; flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: 700;
  }
  .bp-row input {
    flex: 1; height: 100%;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    -moz-appearance: textfield;
  }
  .bp-row input::-webkit-outer-spin-button,
  .bp-row input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .bp-step {
    width: 32px; height: 32px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 16px; font-weight: 800; cursor: pointer;
  }
  .bp-step:hover:not(:disabled) { background: var(--bg-surface); border-color: var(--mode-layout); color: var(--mode-layout); }
  .bp-step:disabled { opacity: .35; cursor: not-allowed; }

  .bp-presets { display: flex; gap: 4px; }
  .bp-presets button {
    flex: 1;
    height: 36px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
  }
  .bp-presets button:hover { background: var(--bg-sunken); }
  .bp-presets button.active {
    background: var(--mode-layout); color: #fff; border-color: var(--mode-layout);
  }
</style>
