<script lang="ts">
  import { modeStore, authStore, editPanelOpen, traylijnStore, type Mode } from '../stores/ui';
  import { onlineStore, pendingCount } from '../stores/state';
  import { useStore } from '../useStore.svelte';
  import MaterialPicker from './MaterialPicker.svelte';

  // Versie-string — bump dit bij iedere build, zo zie je in de UI welke je draait
  const VERSION = 'v3.9.0';
  if (typeof console !== 'undefined') console.log(`[Yard Manager] ${VERSION} loaded`);

  const mode = useStore(modeStore);
  const auth = useStore(authStore);
  const online = useStore(onlineStore);
  const pending = useStore(pendingCount);

  async function forceUpdate() {
    if (!confirm(`Cache wissen en herladen? Niet-gesynchroniseerde wijzigingen worden eerst nog verstuurd.`)) return;
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Wis IndexedDB zodat de app een verse state van de server haalt
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map((db) => {
        if (db.name) return new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(db.name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }));
    } catch (e) {
      console.warn('Cache cleanup error:', e);
    }
    location.reload();
  }

  let { onZoomIn, onZoomOut, onFit, onLoginClick, onLogout } = $props<{
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onLoginClick: () => void;
    onLogout: () => void;
  }>();

  function setMode(m: Mode) {
    modeStore.set(m);
    editPanelOpen.set(m === 'layout');
  }

  const canEdit = $derived(auth.value?.role === 'admin' || auth.value?.role === 'supervisor');

  // Twee-weg bind: MaterialPicker schrijft naar tl1Value/tl2Value via $bindable.
  // We initialiseren één keer uit de store en pushen daarna alleen naar de
  // store (één-richting). Bidirectionele $effects veroorzaken een feedback
  // loop: de pull-effect leest stale store-state en zet de zojuist gekozen
  // waarde direct weer terug naar leeg.
  let tl1Value = $state(traylijnStore.get().tl1);
  let tl2Value = $state(traylijnStore.get().tl2);
  $effect(() => {
    const v1 = tl1Value, v2 = tl2Value;
    const cur = traylijnStore.get();
    if (cur.tl1 !== v1 || cur.tl2 !== v2) {
      traylijnStore.set({ tl1: v1, tl2: v2 });
    }
  });
</script>

<header class="hdr-wrap">
<div class="hdr">
  <div class="hdr-left">
    <div class="logo">
      <span class="logo-mark">Y</span>
      <span class="logo-text">Yard Manager</span>
      <span class="version-tag" title="Klik om cache te wissen en te herladen" onclick={forceUpdate} role="button" tabindex="0">{VERSION} 🔄</span>
    </div>
  </div>

  <div class="hdr-center">
    {#if canEdit}
      <div class="mode-switch" role="tablist">
        <button class="mode-btn" class:active={mode.value === 'view'} onclick={() => setMode('view')}>
          <span class="dot view-dot"></span> Overzicht
        </button>
        <button class="mode-btn" class:active={mode.value === 'layout'} onclick={() => setMode('layout')}>
          <span class="dot layout-dot"></span> Indeling
        </button>
      </div>
    {:else}
      <div class="view-badge">
        <span class="dot view-dot"></span> Overzicht
      </div>
    {/if}
  </div>

  <div class="hdr-traylijnen">
    <label class="tl-slot">
      <span class="tl-name">TL1</span>
      <MaterialPicker bind:value={tl1Value} placeholder="Kies materiaal" showBaseName={true} />
    </label>
    <label class="tl-slot">
      <span class="tl-name">TL2</span>
      <MaterialPicker bind:value={tl2Value} placeholder="Kies materiaal" showBaseName={true} />
    </label>
  </div>

  <div class="hdr-right">
    <div class="status" title={online.value ? 'Online' : 'Offline — wijzigingen worden lokaal opgeslagen'}>
      <span class="dot status-dot" class:on={online.value}></span>
      <span class="status-label">{online.value ? 'Online' : 'Offline'}</span>
      {#if pending.value > 0}
        <span class="sync-badge" title="Niet gesynchroniseerde wijzigingen">{pending.value}</span>
      {/if}
    </div>
    <div class="zoom-group">
      <button class="btn icon ghost" onclick={onZoomOut} title="Uitzoomen">−</button>
      <button class="btn icon ghost" onclick={onFit} title="Pas in scherm">⛶</button>
      <button class="btn icon ghost" onclick={onZoomIn} title="Inzoomen">+</button>
    </div>
    {#if auth.value}
      <button class="btn ghost user" onclick={onLogout} title="Uitloggen">
        <span class="user-mark">{auth.value.username[0]?.toUpperCase()}</span>
        <span class="user-name">{auth.value.username}</span>
      </button>
    {:else}
      <button class="btn primary" onclick={onLoginClick}>Inloggen</button>
    {/if}
  </div>
</div>
</header>

<style>
  .hdr-wrap {
    position: sticky;
    top: 0;
    z-index: 100;
    display: block;
  }
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    background: #fff;
    border-bottom: 1px solid #e2e6ea;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    min-height: 52px;
  }
  .hdr-left, .hdr-right { display: flex; align-items: center; gap: 12px; }
  .hdr-center { flex: 1; display: flex; justify-content: center; }

  .hdr-traylijnen { display: flex; gap: 8px; }
  .tl-slot { display: flex; align-items: center; gap: 6px; }
  .tl-name {
    font-size: 11px; font-weight: 700; color: #2c3e50;
    background: #f0f2f5; padding: 4px 7px; border-radius: 6px;
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .hdr-traylijnen :global(.mp-trigger) {
    height: 32px; padding: 4px 10px; font-size: 12px;
    min-width: 130px; border-radius: 7px;
  }
  @media (max-width: 1100px) {
    .hdr-traylijnen { font-size: 11px; }
  }

  .logo { display: flex; align-items: center; gap: 8px; }
  .logo-mark {
    width: 30px; height: 30px; border-radius: 8px;
    background: linear-gradient(135deg, #2c3e50, #4a6580);
    color: #fff; font-weight: 800; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .logo-text { font-weight: 700; font-size: 15px; color: #1a1a2e; letter-spacing: -0.2px; }
  .version-tag {
    font-size: 10px; font-weight: 700; color: #94a3b8;
    background: #f0f2f5; padding: 2px 8px; border-radius: 10px;
    cursor: pointer; user-select: none; transition: all .12s;
    margin-left: 4px;
  }
  .version-tag:hover { background: #e2e6ea; color: #2c3e50; }

  .view-badge { display: flex; align-items: center; gap: 8px; padding: 7px 14px; background: #f0f2f5; border-radius: 10px; font-size: 13px; font-weight: 600; color: #2c3e50; }
  .mode-switch { display: flex; gap: 2px; background: #f0f2f5; padding: 3px; border-radius: 10px; }
  .mode-btn {
    background: transparent; border: none;
    padding: 6px 18px; border-radius: 7px;
    font-size: 13px; font-weight: 600; color: #555;
    display: flex; align-items: center; gap: 6px;
    transition: all .12s;
  }
  .mode-btn:not(:disabled):hover { background: rgba(0,0,0,0.04); color: #2c3e50; }
  .mode-btn.active { background: #fff; color: #2c3e50; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .mode-btn:disabled { opacity: .35; cursor: not-allowed; }

  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .view-dot { background: #2e86c1; }
  .layout-dot { background: #e67e22; }

  .status { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: #f7f8fa; border-radius: 8px; }
  .status-dot { background: #e74c3c; }
  .status-dot.on { background: #27ae60; box-shadow: 0 0 6px rgba(39,174,96,0.5); }
  .status-label { font-size: 12px; font-weight: 600; color: #555; }
  .sync-badge { background: #e67e22; color: #fff; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; min-width: 20px; text-align: center; animation: pulse 2s infinite; }

  .zoom-group { display: flex; gap: 2px; }
  .zoom-group .btn { font-size: 16px; line-height: 1; min-width: 32px; padding: 4px 10px; }

  .user { display: flex; align-items: center; gap: 6px; }
  .user-mark { width: 24px; height: 24px; border-radius: 50%; background: #2e86c1; color: #fff; font-weight: 700; font-size: 11px; display: flex; align-items: center; justify-content: center; }
  .user-name { font-size: 12px; font-weight: 600; }

  @media (max-width: 720px) {
    .logo-text { display: none; }
    .status-label { display: none; }
    .user-name { display: none; }
    .hdr { padding: 8px 10px; }
    .mode-btn { padding: 6px 12px; font-size: 12px; }
  }
</style>
