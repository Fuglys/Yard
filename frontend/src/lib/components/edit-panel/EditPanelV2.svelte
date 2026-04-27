<script lang="ts">
  import { onDestroy } from 'svelte';
  import { paintToolStore, editPanelOpen, modeStore } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';
  import { history } from '../../stores/history';

  import TabIndeling from './TabIndeling.svelte';
  import TabZakken from './TabZakken.svelte';
  import TabBalen from './TabBalen.svelte';
  import ActiveToolChip from './ActiveToolChip.svelte';
  import BrushPopover from './BrushPopover.svelte';

  type Tab = 'indeling' | 'zakken' | 'balen';
  let activeTab = $state<Tab>('indeling');
  let brushOpen = $state(false);

  const mode = useStore(modeStore);
  const open = useStore(editPanelOpen);

  let canUndo = $state(false);
  let canRedo = $state(false);
  let undoDesc = $state<string | undefined>(undefined);
  let redoDesc = $state<string | undefined>(undefined);
  const unsubHistory = history.subscribe((s) => {
    canUndo = s.canUndo; canRedo = s.canRedo;
    undoDesc = s.pastDesc; redoDesc = s.futureDesc;
  });
  onDestroy(() => unsubHistory());

  function clearTool() {
    paintToolStore.set({ type: 'none' });
  }
</script>

{#if open.value && mode.value === 'layout'}
  <aside class="ep">
    <div class="ep-head">
      <h3>Indeling-tools</h3>
      <span class="ep-mode-badge">Layout edit</span>
    </div>

    <div class="ep-tabs" role="tablist">
      <button
        role="tab"
        class="ep-tab"
        class:active={activeTab === 'indeling'}
        aria-selected={activeTab === 'indeling'}
        onclick={() => (activeTab = 'indeling')}
      >Indeling</button>
      <button
        role="tab"
        class="ep-tab"
        class:active={activeTab === 'zakken'}
        aria-selected={activeTab === 'zakken'}
        onclick={() => (activeTab = 'zakken')}
      >Zakken</button>
      <button
        role="tab"
        class="ep-tab"
        class:active={activeTab === 'balen'}
        aria-selected={activeTab === 'balen'}
        onclick={() => (activeTab = 'balen')}
      >Balen</button>
    </div>

    <div class="ep-body">
      {#if activeTab === 'indeling'}
        <TabIndeling />
      {:else if activeTab === 'zakken'}
        <TabZakken />
      {:else}
        <TabBalen />
      {/if}
    </div>

    <ActiveToolChip onOpenBrush={() => (brushOpen = true)} />

    <div class="ep-footer">
      <button
        class="ep-foot-btn"
        disabled={!canUndo}
        title={undoDesc ? `Ongedaan: ${undoDesc}` : 'Niets om ongedaan te maken'}
        onclick={() => history.undo()}
      >↶ Ongedaan</button>
      <button
        class="ep-foot-btn"
        disabled={!canRedo}
        title={redoDesc ? `Opnieuw: ${redoDesc}` : 'Niets om opnieuw te doen'}
        onclick={() => history.redo()}
      >↷ Opnieuw</button>
      <button
        class="ep-foot-btn"
        title="Deselecteer huidige tool (geen tool actief)"
        onclick={clearTool}
      >✋ Geen tool</button>
    </div>

    <BrushPopover bind:open={brushOpen} />
  </aside>
{/if}

<style>
  .ep {
    position: fixed;
    top: 52px;
    right: 0;
    bottom: 0;
    width: 320px;
    background: var(--bg-app);
    border-left: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-2);
    display: flex;
    flex-direction: column;
    z-index: 90;
  }

  .ep-head {
    height: 48px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 var(--space-3);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
  }
  .ep-head h3 {
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
    color: var(--text-primary);
    font-weight: 700;
  }
  .ep-mode-badge {
    font-size: var(--text-2xs);
    padding: 2px 8px;
    background: rgba(194, 84, 10, 0.12);
    color: var(--mode-layout);
    border-radius: var(--radius-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .ep-tabs {
    height: 48px;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    background: var(--bg-sunken);
    border-bottom: 1px solid var(--border-subtle);
  }
  .ep-tab {
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color .12s, background .12s, border-color .12s;
  }
  .ep-tab:hover { background: var(--bg-surface); color: var(--text-primary); }
  .ep-tab.active {
    background: var(--bg-surface);
    color: var(--mode-layout);
    border-bottom-color: var(--mode-layout);
  }
  .ep-tab:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }

  .ep-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }

  .ep-footer {
    height: 64px;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-2);
  }
  .ep-foot-btn {
    height: 100%;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: background .12s, border-color .12s;
  }
  .ep-foot-btn:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--mode-layout);
  }
  .ep-foot-btn:disabled { opacity: .35; cursor: not-allowed; }
</style>
