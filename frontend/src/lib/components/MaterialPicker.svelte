<script lang="ts">
  import { materialsStore, type Material } from '../stores/materials';
  import { useStore } from '../useStore.svelte';

  const materials = useStore(materialsStore);

  let { value = $bindable(''), placeholder = 'Selecteer materiaal…', allowClear = true, showBaseName = false } = $props<{
    value: string;
    placeholder?: string;
    allowClear?: boolean;
    showBaseName?: boolean;
  }>();

  let open = $state(false);
  let query = $state('');
  let triggerEl: HTMLButtonElement;

  // Strip S/T suffix voor weergave: "Attewimi S" → "Attewimi"
  function baseName(name: string): string {
    if (!showBaseName) return name;
    return name.replace(/\s+[STst]$/,'').trim();
  }

  // Groepeer materialen: test-materialen onderaan, met prefix
  function displayName(m: Material): string {
    const base = baseName(m.name);
    if (m.is_test) return `(test) ${base}`;
    return base;
  }

  const filtered = $derived(
    (() => {
      let list = query
        ? materials.value.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()) || baseName(m.name).toLowerCase().includes(query.toLowerCase()))
        : materials.value;
      // Sorteer: normaal eerst, test onderaan
      let sorted = [...list].sort((a, b) => {
        if (a.is_test && !b.is_test) return 1;
        if (!a.is_test && b.is_test) return -1;
        return baseName(a.name).localeCompare(baseName(b.name));
      });
      // Dedupliceer op basisnaam als showBaseName actief is
      if (showBaseName) {
        const seen = new Set<string>();
        sorted = sorted.filter(m => {
          const key = baseName(m.name).toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return sorted;
    })()
  );

  function pick(name: string) {
    value = name;
    open = false;
    query = '';
  }

  function clear() {
    value = '';
    open = false;
  }

  function toggle() {
    open = !open;
    if (open) setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>('.mp-search-input');
      inp?.focus();
    }, 30);
  }

  function onClickOutside(e: MouseEvent) {
    if (!open) return;
    if (!(e.target as HTMLElement).closest('.mp')) open = false;
  }
</script>

<svelte:window onclick={onClickOutside} />

<div class="mp">
  <button bind:this={triggerEl} type="button" class="mp-trigger" onclick={toggle}>
    <span class:placeholder={!value}>{value ? baseName(value) : placeholder}</span>
    <span class="caret">▾</span>
  </button>
  {#if open}
    <div class="mp-pop">
      <input
        class="mp-search-input"
        type="text" placeholder="Zoek…"
        bind:value={query}
        autocomplete="off"
      />
      <div class="mp-list">
        {#if allowClear && value}
          <button class="mp-opt clear" onclick={clear}>✕ Wissen</button>
        {/if}
        {#each filtered as m (m.id)}
          <button class="mp-opt" class:selected={m.name === value} class:test={m.is_test} onclick={() => pick(m.name)}>
            {displayName(m)}
          </button>
        {/each}
        {#if filtered.length === 0}
          <div class="mp-empty">Geen resultaten</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .mp { position: relative; display: inline-block; }
  .mp-trigger {
    display: flex; align-items: center; gap: 8px;
    background: #fff; border: 1px solid #d5d8dc; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600;
    color: #2c3e50; min-width: 180px; justify-content: space-between;
    transition: border-color .12s;
  }
  .mp-trigger:hover { border-color: #94a3b8; }
  .placeholder { color: #94a3b8; font-weight: 500; }
  .caret { color: #94a3b8; font-size: 11px; }
  .mp-pop {
    position: absolute; top: calc(100% + 4px); left: 0;
    background: #fff; border: 1px solid #e2e6ea; border-radius: 10px;
    min-width: 240px; max-width: 320px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.12);
    z-index: 500; padding: 6px;
    animation: scaleIn .12s ease-out;
  }
  .mp-search-input {
    width: 100%; padding: 8px 10px; border: 1px solid #e2e6ea; border-radius: 7px;
    background: #f7f8fa; font-size: 13px; outline: none; margin-bottom: 4px;
  }
  .mp-search-input:focus { border-color: #2e86c1; background: #fff; }
  .mp-list { max-height: 280px; overflow-y: auto; }
  .mp-opt {
    display: block; width: 100%; text-align: left;
    background: transparent; border: 0;
    padding: 8px 10px; font-size: 13px; color: #2c3e50;
    border-radius: 6px; transition: background .1s;
  }
  .mp-opt:hover { background: #f0f2f5; }
  .mp-opt.selected { background: #e8f4fd; color: #1f6391; font-weight: 600; }
  .mp-opt.clear { color: #e74c3c; font-weight: 600; }
  .mp-opt.test { color: #8e44ad; font-style: italic; }
  .mp-empty { padding: 14px; text-align: center; font-size: 12px; color: #94a3b8; }
</style>
