<script lang="ts">
  let {
    label,
    swatchColor = '#cbd5e1',
    swatchStyle = '',
    active = false,
    danger = false,
    onclick,
    title = '',
  } = $props<{
    label: string;
    swatchColor?: string;
    swatchStyle?: string;
    active?: boolean;
    danger?: boolean;
    onclick?: () => void;
    title?: string;
  }>();
</script>

<button
  class="ep-tool"
  class:active
  class:danger
  aria-pressed={active}
  {title}
  {onclick}
>
  <span class="ep-swatch" style={swatchStyle || `background:${swatchColor};`}></span>
  <span class="ep-label">{label}</span>
</button>

<style>
  .ep-tool {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 48px;
    padding: 0 var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: background .12s, border-color .12s, transform .08s;
  }
  .ep-tool:hover { background: var(--bg-sunken); }
  .ep-tool:active { transform: translateY(1px); }
  .ep-tool.active {
    background: rgba(194, 84, 10, 0.12);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
  }
  .ep-tool.danger { color: var(--accent-danger); }
  .ep-tool.danger.active {
    background: rgba(185, 28, 28, 0.10);
    border-color: var(--accent-danger);
    color: var(--accent-danger);
  }
  .ep-swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.06);
    flex-shrink: 0;
  }
  .ep-label { line-height: 1.2; }
</style>
