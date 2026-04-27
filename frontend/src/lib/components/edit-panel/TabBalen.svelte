<script lang="ts">
  import { paintToolStore, type PaintTool } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';
  import SectionCard from './SectionCard.svelte';

  const paint = useStore(paintToolStore);

  let bunkerName = $state('');

  function setTool(t: PaintTool) { paintToolStore.set(t); }
  function isActive(type: string) { return paint.value.type === type; }

  function applyBunker() {
    setTool({ type: 'bunker', label: bunkerName.trim(), color: '#9A3412' });
  }
</script>

<SectionCard title="Bunker plaatsen">
  <div class="bunker-name-wrap">
    <label class="bunker-label" for="bunker-name">Naam (optioneel)</label>
    <input
      id="bunker-name"
      class="bunker-input"
      type="text"
      bind:value={bunkerName}
      placeholder="Bijv. Bunker A"
    />
  </div>

  <button
    class="bunker-btn"
    class:active={isActive('bunker')}
    aria-pressed={isActive('bunker')}
    onclick={applyBunker}
  >
    <span class="bunker-icon-wrap">
      <span class="bunker-icon-block"></span>
    </span>
    <span class="bunker-btn-info">
      <span class="bunker-btn-title">Bunker</span>
      <span class="bunker-btn-sub">Schilder op het canvas</span>
    </span>
  </button>

  <div class="tip-card">
    <span class="tip-icon">💡</span>
    <p class="tip-text">Na plaatsing kun je in <strong>Inhoud</strong>-modus direct materiaal toewijzen aan de bunker.</p>
  </div>
</SectionCard>

<style>
  /* ─── Naam invoer ─── */
  .bunker-name-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bunker-label {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .bunker-input {
    height: 40px;
    padding: 0 var(--space-3);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-sunken);
    font-size: var(--text-sm);
    color: var(--text-primary);
    outline: none;
    transition: border-color .12s, background .12s;
  }
  .bunker-input:focus {
    border-color: var(--mode-layout);
    background: var(--bg-surface);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.1);
  }
  .bunker-input::placeholder {
    color: var(--text-tertiary);
  }

  /* ─── Bunker knop ─── */
  .bunker-btn {
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
  .bunker-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .bunker-btn.active {
    background: rgba(154, 52, 18, 0.08);
    border-color: var(--accent-bunker);
    box-shadow: 0 0 0 2px rgba(154, 52, 18, 0.15);
  }

  .bunker-icon-wrap {
    width: 36px;
    height: 36px;
    background: rgba(154, 52, 18, 0.1);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .bunker-btn.active .bunker-icon-wrap {
    background: rgba(154, 52, 18, 0.18);
  }
  .bunker-icon-block {
    width: 18px;
    height: 14px;
    background: var(--accent-bunker);
    border-radius: 3px;
  }

  .bunker-btn-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
  }
  .bunker-btn-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .bunker-btn.active .bunker-btn-title {
    color: var(--accent-bunker);
  }
  .bunker-btn-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* ─── Tip kaart ─── */
  .tip-card {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
  }
  .tip-icon {
    font-size: 16px;
    line-height: 1.3;
    flex-shrink: 0;
  }
  .tip-text {
    font-size: var(--text-xs);
    line-height: var(--text-xs-line);
    color: var(--text-secondary);
  }
  .tip-text strong {
    color: var(--mode-content);
    font-weight: 700;
  }
</style>
