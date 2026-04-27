<script lang="ts">
  let { title, children } = $props<{ title: string; children?: any }>();
</script>

<section class="ep-card">
  <h4 class="ep-card-title">{title}</h4>
  <div class="ep-card-body">
    {@render children?.()}
  </div>
</section>

<style>
  .ep-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    padding: var(--space-3);
    margin-bottom: var(--space-2);
    transition: box-shadow .15s ease;
  }
  .ep-card:hover {
    box-shadow: 0 2px 6px rgba(15,23,42,.07), 0 1px 3px rgba(15,23,42,.04);
  }
  .ep-card-title {
    font-size: var(--text-2xs);
    line-height: var(--text-2xs-line);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
  }
  .ep-card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
