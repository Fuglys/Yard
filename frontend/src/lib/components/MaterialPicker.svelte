<script lang="ts">
  import { materialsStore } from '../stores/materials';
  import { useStore } from '../useStore.svelte';

  const materials = useStore(materialsStore);

  let { value = $bindable(''), placeholder = 'Selecteer materiaal…', allowClear = true } = $props<{
    value: string;
    placeholder?: string;
    allowClear?: boolean;
  }>();

  let open = $state(false);
  let query = $state('');
  let triggerEl: HTMLButtonElement;

  const filtered = $derived(
    query
      ? materials.value.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
      : materials.value
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
    <span class:placeholder={!value}>{value || placeholder}</span>
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
          <button class="mp-opt" class:selected={m.name === value} onclick={() => pick(m.name)}>
            {m.name}
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
  .mp-empty { padding: 14px; text-align: center; font-size: 12px; color: #94a3b8; }
</style>
