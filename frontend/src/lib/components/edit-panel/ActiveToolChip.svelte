<script lang="ts">
  import { paintToolStore, brushSizeStore } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';

  let { onOpenBrush } = $props<{ onOpenBrush: () => void }>();

  const paint = useStore(paintToolStore);
  const brush = useStore(brushSizeStore);

  // Brush only relevant for free-form paint tools.
  // Snap-tools (zak) and non-paint tools (select, none, eraser, line-lock) hide chip.
  const showsBrush = $derived(['wall', 'container', 'afval', 'custom', 'bunker'].includes(paint.value.type));

  const toolLabel = $derived.by(() => {
    switch (paint.value.type) {
      case 'select': return '🎯 Selecteren';
      case 'pick-area': return '👆 Losse selectie';
      case 'wall': return '🧱 Muur';
      case 'container': return '📦 Container';
      case 'afval': return '🗑 Afval';
      case 'zak': return '⬜ Zak (2×2)';
      case 'bunker': return `🟧 Bunker${(paint.value as any).label ? ` · ${(paint.value as any).label}` : ''}`;
      case 'custom': return `🎨 ${(paint.value as any).label || 'Vlak'}`;
      case 'eraser': return '🧹 Wissen';
      case 'none': return 'Geen tool';
      default: return 'Tool';
    }
  });
</script>

<div class="atc-wrap">
  <div class="atc-label">Active tool</div>
  <div class="atc">
    <span class="atc-tool">{toolLabel}</span>
    {#if showsBrush}
      <button class="atc-brush tnum" onclick={onOpenBrush} title="Penseel aanpassen">
        {brush.value.w} × {brush.value.h} <span class="caret">▾</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .atc-wrap {
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .atc-label {
    font-size: var(--text-2xs);
    line-height: var(--text-2xs-line);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: var(--space-1);
  }
  .atc {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-3);
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .atc-tool {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .atc-brush {
    height: 32px;
    padding: 0 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .atc-brush:hover { border-color: var(--mode-layout); color: var(--mode-layout); }
  .caret { color: var(--text-tertiary); font-size: 10px; }
</style>
