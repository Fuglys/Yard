<script lang="ts">
  import { areasStore } from '../stores/state';
  import { lastPlacedAreaId, toast } from '../stores/ui';
  import { useStore } from '../useStore.svelte';
  import { setMaterialForArea } from '../stores/period';
  import MaterialPicker from './MaterialPicker.svelte';

  const lastId = useStore(lastPlacedAreaId);
  const areas = useStore(areasStore);

  let material = $state('');
  let dismissTimer: number | null = null;

  const area = $derived(lastId.value != null ? areas.value.get(lastId.value) ?? null : null);

  // Reset & schedule auto-dismiss whenever lastPlacedAreaId changes
  $effect(() => {
    if (lastId.value != null) {
      material = '';
      if (dismissTimer != null) clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        if (lastPlacedAreaId.get() === lastId.value) {
          lastPlacedAreaId.set(null);
        }
      }, 6000);
    } else {
      if (dismissTimer != null) { clearTimeout(dismissTimer); dismissTimer = null; }
    }
  });

  function dismiss() {
    if (dismissTimer != null) { clearTimeout(dismissTimer); dismissTimer = null; }
    lastPlacedAreaId.set(null);
  }

  async function assign() {
    if (!area) return;
    const trimmed = (material || '').trim();
    if (!trimmed) {
      toast('Kies eerst een materiaal');
      return;
    }
    await setMaterialForArea(area.id, trimmed);
    toast(`${area.name || 'Vlak'} → ${trimmed}`);
    dismiss();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (lastId.value == null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if area}
  <div class="chip" role="dialog" aria-label="Materiaal toewijzen">
    <div class="chip-head">
      <span class="chip-eyebrow">Net geplaatst</span>
      <span class="chip-title">{area.name || (area.area_type === 'bunker' ? 'Bunker' : 'Vlak')}</span>
    </div>
    <div class="chip-question">Materiaal voor deze {area.area_type === 'bunker' ? 'bunker' : 'rij'}?</div>
    <div class="chip-mp">
      <MaterialPicker bind:value={material} placeholder="Zoek materiaal…" />
    </div>
    <div class="chip-actions">
      <button class="chip-btn ghost" onclick={dismiss}>Overslaan</button>
      <button class="chip-btn primary" onclick={assign} disabled={!material.trim()}>Toewijzen</button>
    </div>
  </div>
{/if}

<style>
  .chip {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1400;
    width: min(380px, calc(100vw - 32px));
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-3);
    padding: var(--space-3) var(--space-4);
    display: flex; flex-direction: column;
    gap: var(--space-2);
    animation: chipIn .18s cubic-bezier(.2,.9,.3,1.1);
  }
  @keyframes chipIn {
    from { transform: translate(-50%, 12px); opacity: 0; }
    to   { transform: translate(-50%, 0); opacity: 1; }
  }
  .chip-head { display: flex; flex-direction: column; gap: 1px; }
  .chip-eyebrow {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .chip-title {
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--text-primary);
  }
  .chip-question {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .chip-mp :global(.mp), .chip-mp :global(.mp-trigger) {
    width: 100%;
  }
  .chip-mp :global(.mp-trigger) {
    height: 40px; min-width: 0;
    border-radius: var(--radius-md);
  }
  .chip-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: 2px;
  }
  .chip-btn {
    height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: background .12s, transform .08s;
  }
  .chip-btn.ghost { background: transparent; border-color: var(--border-strong); color: var(--text-secondary); }
  .chip-btn.ghost:hover { background: var(--bg-sunken); }
  .chip-btn.primary {
    background: var(--mode-content);
    color: #fff;
    border-color: var(--mode-content);
  }
  .chip-btn.primary:hover:not(:disabled) { background: #166934; }
  .chip-btn:disabled { opacity: .45; cursor: not-allowed; }
  .chip-btn:active:not(:disabled) { transform: translateY(1px); }
</style>
