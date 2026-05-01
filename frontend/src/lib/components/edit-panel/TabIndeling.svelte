<script lang="ts">
  import { paintToolStore, lineLockStore, toast, backgroundImageStore, brushSizeStore, type PaintTool } from '../../stores/ui';
  import { useStore } from '../../useStore.svelte';
  import { apiUrl } from '../../api';
  import { db } from '../../db/dexie';
  import { areasStore, cellsStore } from '../../stores/state';
  import { fullSync } from '../../sync/engine';
  import SectionCard from './SectionCard.svelte';
  import ToolButton from './ToolButton.svelte';

  const paint = useStore(paintToolStore);
  const lineLock = useStore(lineLockStore);
  const bg = useStore(backgroundImageStore);
  const brush = useStore(brushSizeStore);

  function setBrush(w: number, h: number) {
    brushSizeStore.set({
      w: Math.max(1, Math.min(20, Math.round(w || 1))),
      h: Math.max(1, Math.min(20, Math.round(h || 1))),
    });
  }
  function setSquare(n: number) { setBrush(n, n); }

  let customName = $state('');
  let customColor = $state('#C2540A');

  function setTool(t: PaintTool) {
    // Toggle: als deze tool al actief is, deselecteer (set naar 'none').
    if (paint.value.type === t.type) {
      paintToolStore.set({ type: 'none' });
    } else {
      paintToolStore.set(t);
    }
  }
  function isActive(type: string) { return paint.value.type === type; }

  function toggleBgVisible() {
    const wasVisible = bg.value.visible;
    backgroundImageStore.update((s) => ({ ...s, visible: !s.visible }));
    // Wanneer uitgezet en achtergrond-tool actief was → schakel terug naar select
    // (anders blijft de tool 'background' geselecteerd zonder zichtbare image).
    if (wasVisible && paint.value.type === 'background') {
      paintToolStore.set({ type: 'select' });
    }
  }

  function recenterBg() {
    window.dispatchEvent(new CustomEvent('yard-bg-recenter'));
  }

  function setBgOpacity(v: number) {
    backgroundImageStore.update((s) => ({ ...s, opacity: Math.max(0.1, Math.min(1, v)) }));
  }

  function setBgScale(v: number) {
    const clamped = Math.max(0.1, Math.min(5, v));
    backgroundImageStore.update((s) => ({ ...s, scale: clamped }));
  }

  function resetBg() {
    window.dispatchEvent(new CustomEvent('yard-bg-reset'));
  }

  // Verplaatsen: stap-grootte in cellen (1 cel = 24px).
  const CELL_PX = 24;
  let nudgeStepCells = $state(5);
  function nudgeBg(dxCells: number, dyCells: number) {
    const px = nudgeStepCells * CELL_PX;
    backgroundImageStore.update((s) => ({
      ...s,
      x: s.x + dxCells * px,
      y: s.y + dyCells * px,
      initialized: true,
    }));
  }

  // Knop "Achtergrond" als selectie-tool: zet de achtergrond aan als 'ie nog uit was.
  function selectBgTool() {
    if (!bg.value.visible) {
      backgroundImageStore.update((s) => ({ ...s, visible: true }));
    }
    paintToolStore.set({ type: 'background' });
  }

  function applyCustom() {
    if (!customName.trim()) { toast('Geef het vlak een naam'); return; }
    setTool({ type: 'custom', label: customName.trim(), color: customColor, areaType: 'custom' });
  }

  async function wipeAll() {
    if (!confirm('Weet je zeker dat je de VOLLEDIGE layout wilt wissen?\n\nAlle cellen, zakken, muren, bunkers — alles wordt verwijderd.\nDit kan NIET ongedaan gemaakt worden.')) return;
    try {
      // Wis server
      const res = await fetch(apiUrl('/api/wipe-layout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(`Server: ${res.status}`);
      // Wis lokale IndexedDB
      await db.transaction('rw', db.areas, db.cells, db.pending, async () => {
        await db.areas.clear();
        await db.cells.clear();
        await db.pending.clear();
      });
      // Reset in-memory stores
      areasStore.set(new Map());
      cellsStore.set(new Map());
      toast('Layout volledig gewist');
    } catch (e: any) {
      console.error('Wipe failed:', e);
      // Fallback: wis alleen lokaal en doe full sync
      try {
        await db.transaction('rw', db.areas, db.cells, db.pending, db.kv, async () => {
          await db.areas.clear();
          await db.cells.clear();
          await db.pending.clear();
          await db.kv.delete('lastSyncTs');
        });
        areasStore.set(new Map());
        cellsStore.set(new Map());
        await fullSync();
        toast('Lokale layout gewist en opnieuw gesynchroniseerd');
      } catch (e2) {
        toast('Wissen mislukt — probeer de pagina te herladen');
      }
    }
  }
</script>

<!-- ─── Selectie ─── -->
<SectionCard title="Selectie & navigatie">
  <div class="select-row">
    <button
      class="select-card"
      class:active={isActive('select')}
      aria-pressed={isActive('select')}
      onclick={() => setTool({ type: 'select' })}
      title="Sleep een rechthoek; daarna handles voor verplaatsen / resizen."
    >
      <span class="select-swatch" style="background:linear-gradient(135deg,#1F6FB2,#175a90)"></span>
      <span class="select-label">Indeling</span>
      <span class="select-sub">Selectie + verplaatsen</span>
    </button>
    <button
      class="select-card"
      class:active={isActive('background')}
      aria-pressed={isActive('background')}
      onclick={selectBgTool}
      title="Sleep de achtergrond-afbeelding om hem te verplaatsen. Zet de achtergrond automatisch aan als 'ie nog uit was."
    >
      <span class="select-swatch bg-swatch">🖼</span>
      <span class="select-label">Achtergrond</span>
      <span class="select-sub">{bg.value.visible ? 'Verplaats afbeelding' : 'Toon + verplaats'}</span>
    </button>
  </div>
  <button
    class="pick-area-btn"
    class:active={isActive('pick-area')}
    aria-pressed={isActive('pick-area')}
    onclick={() => setTool({ type: 'pick-area' })}
    title="Tik op een getekend vlak om alle aansluitende cellen als één veld te selecteren. Daarna verschijnt de inspector waar je het veld een naam kunt geven."
  >
    <span class="pick-area-icon">👆</span>
    <span class="pick-area-text">
      <span class="pick-area-title">Losse selectie</span>
      <span class="pick-area-sub">Tik op vlak → inspector opent</span>
    </span>
  </button>
  <p class="section-hint">
    <strong>Indeling</strong>: rechthoek slepen → handles voor verplaatsen/resize (<kbd>Shift</kbd> = proportioneel).
    <strong>Achtergrond</strong>: sleep de afbeelding zelf om hem te positioneren.
  </p>
</SectionCard>

<!-- ─── Achtergrond-afbeelding ─── -->
<SectionCard title="Achtergrond-afbeelding">
  <button
    class="bg-toggle"
    class:on={bg.value.visible}
    aria-pressed={bg.value.visible}
    onclick={toggleBgVisible}
    title="Toon de tekening uit background.png onder het grid"
  >
    <span class="bg-toggle-icon">{bg.value.visible ? '👁' : '🚫'}</span>
    <span class="bg-toggle-text">
      <span class="bg-toggle-title">Achtergrond {bg.value.visible ? 'aan' : 'uit'}</span>
      <span class="bg-toggle-sub">Alleen zichtbaar in Indeling-modus</span>
    </span>
    <span class="bg-toggle-pill">{bg.value.visible ? 'AAN' : 'UIT'}</span>
  </button>

  <div class="bg-row">
    <button
      class="bg-action"
      onclick={recenterBg}
      disabled={!bg.value.visible}
      title="Plaats de afbeelding terug in het midden van het grid"
    >
      🎯 Centreer
    </button>
    <button
      class="bg-action danger"
      onclick={resetBg}
      disabled={!bg.value.visible}
      title="Reset positie + schaal naar default (gecentreerd, 100%)"
    >
      ↺ Reset alles
    </button>
  </div>

  <label class="bg-opacity">
    <span class="bg-opacity-label">
      <span>Doorzichtigheid</span>
      <span class="bg-opacity-val">{Math.round(bg.value.opacity * 100)}%</span>
    </span>
    <input
      type="range"
      min="0.1"
      max="1"
      step="0.05"
      value={bg.value.opacity}
      oninput={(e) => setBgOpacity(parseFloat((e.target as HTMLInputElement).value))}
      disabled={!bg.value.visible}
    />
  </label>

  <label class="bg-opacity">
    <span class="bg-opacity-label">
      <span>Schaalgrootte</span>
      <span class="bg-opacity-val">{Math.round(bg.value.scale * 100)}%</span>
    </span>
    <input
      type="range"
      min="0.1"
      max="3"
      step="0.05"
      value={bg.value.scale}
      oninput={(e) => setBgScale(parseFloat((e.target as HTMLInputElement).value))}
      disabled={!bg.value.visible}
    />
    <div class="bg-presets">
      <button onclick={() => setBgScale(0.5)}  disabled={!bg.value.visible}>50%</button>
      <button onclick={() => setBgScale(1)}    disabled={!bg.value.visible}>100%</button>
      <button onclick={() => setBgScale(1.5)}  disabled={!bg.value.visible}>150%</button>
      <button onclick={() => setBgScale(2)}    disabled={!bg.value.visible}>200%</button>
    </div>
  </label>

  <div class="bg-nudge">
    <div class="bg-nudge-head">
      <span class="bg-nudge-title">Verplaats met knoppen</span>
      <div class="bg-step-row" role="radiogroup" aria-label="Stapgrootte">
        <button
          class="bg-step"
          class:active={nudgeStepCells === 1}
          onclick={() => (nudgeStepCells = 1)}
          disabled={!bg.value.visible}
          title="Stap = 1 cel (24px)"
        >1</button>
        <button
          class="bg-step"
          class:active={nudgeStepCells === 5}
          onclick={() => (nudgeStepCells = 5)}
          disabled={!bg.value.visible}
          title="Stap = 5 cellen (120px)"
        >5</button>
        <button
          class="bg-step"
          class:active={nudgeStepCells === 25}
          onclick={() => (nudgeStepCells = 25)}
          disabled={!bg.value.visible}
          title="Stap = 25 cellen (600px)"
        >25</button>
        <span class="bg-step-label">cel{nudgeStepCells === 1 ? '' : 'len'}</span>
      </div>
    </div>
    <div class="bg-pad">
      <button class="bg-pad-btn nw" onclick={() => nudgeBg(-1, -1)} disabled={!bg.value.visible} title="Linksboven">↖</button>
      <button class="bg-pad-btn n"  onclick={() => nudgeBg(0, -1)}  disabled={!bg.value.visible} title="Omhoog">↑</button>
      <button class="bg-pad-btn ne" onclick={() => nudgeBg(1, -1)}  disabled={!bg.value.visible} title="Rechtsboven">↗</button>
      <button class="bg-pad-btn w"  onclick={() => nudgeBg(-1, 0)}  disabled={!bg.value.visible} title="Naar links">←</button>
      <button class="bg-pad-btn c"  onclick={recenterBg}            disabled={!bg.value.visible} title="Centreer">●</button>
      <button class="bg-pad-btn e"  onclick={() => nudgeBg(1, 0)}   disabled={!bg.value.visible} title="Naar rechts">→</button>
      <button class="bg-pad-btn sw" onclick={() => nudgeBg(-1, 1)}  disabled={!bg.value.visible} title="Linksonder">↙</button>
      <button class="bg-pad-btn s"  onclick={() => nudgeBg(0, 1)}   disabled={!bg.value.visible} title="Omlaag">↓</button>
      <button class="bg-pad-btn se" onclick={() => nudgeBg(1, 1)}   disabled={!bg.value.visible} title="Rechtsonder">↘</button>
    </div>
  </div>

  <p class="section-hint">
    Teken je grid gewoon over de afbeelding heen. Voor losse muis-drag: kies hierboven
    de <strong>Achtergrond</strong>-knop. De stap-knoppen werken op cel-grootte (1 cel = 24px).
  </p>
</SectionCard>

<!-- ─── Vaste structuren ─── -->
<SectionCard title="Vaste structuren">
  <div class="struct-grid">
    <button
      class="struct-card"
      class:active={isActive('wall')}
      aria-pressed={isActive('wall')}
      onclick={() => setTool({ type: 'wall' })}
      title="Muur plaatsen"
    >
      <span class="struct-icon" style="background:#0F172A">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="3" width="7" height="5" rx="1" fill="#fff" opacity=".9"/>
          <rect x="10" y="3" width="7" height="5" rx="1" fill="#fff" opacity=".7"/>
          <rect x="4" y="10" width="7" height="5" rx="1" fill="#fff" opacity=".9"/>
          <rect x="13" y="10" width="4" height="5" rx="1" fill="#fff" opacity=".7"/>
          <rect x="1" y="10" width="1" height="5" rx=".5" fill="#fff" opacity=".5"/>
        </svg>
      </span>
      <span class="struct-label">Muur</span>
    </button>

    <button
      class="struct-card"
      class:active={isActive('container')}
      aria-pressed={isActive('container')}
      onclick={() => setTool({ type: 'container', label: 'Container' })}
      title="Container plaatsen"
    >
      <span class="struct-icon" style="background:#64748B">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="2" y="4" width="14" height="10" rx="2" fill="#fff" opacity=".9"/>
          <line x1="6" y1="4" x2="6" y2="14" stroke="#64748B" stroke-width="1.2" opacity=".5"/>
          <line x1="12" y1="4" x2="12" y2="14" stroke="#64748B" stroke-width="1.2" opacity=".5"/>
        </svg>
      </span>
      <span class="struct-label">Container</span>
    </button>

    <button
      class="struct-card"
      class:active={isActive('afval')}
      aria-pressed={isActive('afval')}
      onclick={() => setTool({ type: 'afval', label: 'Afval' })}
      title="Afvalzone plaatsen"
    >
      <span class="struct-icon" style="background:#94A3B8">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M5 5h8l-1 10H6L5 5z" fill="#fff" opacity=".9"/>
          <rect x="4" y="3" width="10" height="2" rx="1" fill="#fff" opacity=".7"/>
          <line x1="7" y1="7" x2="7.5" y2="13" stroke="#94A3B8" stroke-width="1" opacity=".5"/>
          <line x1="11" y1="7" x2="10.5" y2="13" stroke="#94A3B8" stroke-width="1" opacity=".5"/>
        </svg>
      </span>
      <span class="struct-label">Afval</span>
    </button>
  </div>
  <p class="section-hint">Kies een structuur en schilder op het canvas. Gebruik de penseelgrootte hieronder voor grotere vlakken.</p>
</SectionCard>

<!-- ─── Penseelgrootte ─── -->
<SectionCard title="Penseelgrootte">
  <div class="brush-hero">
    <div
      class="brush-grid"
      style="grid-template-columns: repeat({Math.min(brush.value.w, 8)}, 1fr); grid-template-rows: repeat({Math.min(brush.value.h, 8)}, 1fr);"
    >
      {#each Array(Math.min(brush.value.w, 8) * Math.min(brush.value.h, 8)) as _, i (i)}
        <div class="brush-cell"></div>
      {/each}
    </div>
    <div class="brush-meta">
      <div class="brush-dim tnum">{brush.value.w} × {brush.value.h}</div>
      <div class="brush-cells tnum">{brush.value.w * brush.value.h} cel{brush.value.w * brush.value.h === 1 ? '' : 'len'}</div>
    </div>
  </div>

  <div class="brush-row">
    <span class="brush-row-label">Breed</span>
    <button class="brush-step" onclick={() => setBrush(brush.value.w - 1, brush.value.h)} disabled={brush.value.w <= 1} title="Smaller">−</button>
    <input
      class="tnum brush-input"
      type="number" min="1" max="20" value={brush.value.w}
      oninput={(e) => setBrush(parseInt((e.currentTarget as HTMLInputElement).value || '1'), brush.value.h)}
    />
    <button class="brush-step" onclick={() => setBrush(brush.value.w + 1, brush.value.h)} disabled={brush.value.w >= 20} title="Breder">+</button>
  </div>

  <div class="brush-row">
    <span class="brush-row-label">Hoog</span>
    <button class="brush-step" onclick={() => setBrush(brush.value.w, brush.value.h - 1)} disabled={brush.value.h <= 1} title="Lager">−</button>
    <input
      class="tnum brush-input"
      type="number" min="1" max="20" value={brush.value.h}
      oninput={(e) => setBrush(brush.value.w, parseInt((e.currentTarget as HTMLInputElement).value || '1'))}
    />
    <button class="brush-step" onclick={() => setBrush(brush.value.w, brush.value.h + 1)} disabled={brush.value.h >= 20} title="Hoger">+</button>
  </div>

  <div class="brush-presets">
    <button class:active={brush.value.w === 1 && brush.value.h === 1} onclick={() => setSquare(1)}>1×1</button>
    <button class:active={brush.value.w === 2 && brush.value.h === 2} onclick={() => setSquare(2)}>2×2</button>
    <button class:active={brush.value.w === 3 && brush.value.h === 3} onclick={() => setSquare(3)}>3×3</button>
    <button class:active={brush.value.w === 5 && brush.value.h === 5} onclick={() => setSquare(5)}>5×5</button>
    <button class:active={brush.value.w === 10 && brush.value.h === 10} onclick={() => setSquare(10)}>10×10</button>
  </div>

  <p class="section-hint">
    Werkt voor muur, container, afval en aangepaste vlakken. Voor zakken (2×2) en nummering ligt de grootte vast.
  </p>
</SectionCard>

<!-- ─── Aangepast vlak ─── -->
<SectionCard title="Aangepast vlak">
  <div class="custom-row">
    <div class="custom-input-wrap">
      <input
        class="custom-text"
        type="text"
        bind:value={customName}
        placeholder="Naam van het vlak…"
      />
    </div>
    <label class="custom-color-wrap" title="Kleur kiezen">
      <span class="custom-color-preview" style="background:{customColor}"></span>
      <input class="custom-color-input" type="color" bind:value={customColor} />
    </label>
  </div>
  <button
    class="custom-paint-btn"
    class:active={isActive('custom')}
    aria-pressed={isActive('custom')}
    onclick={applyCustom}
  >
    <span class="custom-paint-swatch" style="background:{customColor}"></span>
    <span>Schilder vlak</span>
  </button>
  <p class="section-hint">Maak een vlak met een eigen naam en kleur. Handig voor speciale zones.</p>
</SectionCard>

<!-- ─── Hulpmiddelen ─── -->
<SectionCard title="Hulpmiddelen">
  <div class="tools-grid">
    <button
      class="tool-card"
      class:active={lineLock.value}
      aria-pressed={lineLock.value}
      onclick={() => lineLockStore.set(!lineLock.value)}
      title="Tekent rechte lijnen langs één as"
    >
      <span class="tool-icon line-icon">📏</span>
      <span class="tool-info">
        <span class="tool-name">Rechte lijn</span>
        <span class="tool-status" class:on={lineLock.value}>{lineLock.value ? 'Aan' : 'Uit'}</span>
      </span>
    </button>

    <button
      class="tool-card danger"
      class:active={isActive('eraser')}
      aria-pressed={isActive('eraser')}
      onclick={() => setTool({ type: 'eraser' })}
      title="Wis cellen van het canvas"
    >
      <span class="tool-icon eraser-icon">🧹</span>
      <span class="tool-info">
        <span class="tool-name">Wissen</span>
        <span class="tool-status">Verwijder cellen</span>
      </span>
    </button>
  </div>
  <p class="section-hint">
    <kbd>Shift</kbd> ingedrukt houden werkt ook als rechte-lijn modus op desktop.
  </p>
</SectionCard>

<!-- ─── Alles wissen ─── -->
<SectionCard title="Reset">
  <button class="wipe-btn" onclick={wipeAll} title="Wis de volledige layout (server + lokaal)">
    🗑️ Wis volledige layout
  </button>
  <p class="section-hint">Verwijdert alle cellen en vlakken. Dit kan niet ongedaan gemaakt worden.</p>
</SectionCard>

<style>
  /* ─── Section hints ─── */
  .section-hint {
    font-size: var(--text-xs);
    line-height: var(--text-xs-line);
    color: var(--text-tertiary);
    padding: var(--space-1) 0 0;
  }
  kbd {
    background: var(--bg-sunken);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 10px;
    box-shadow: 0 1px 0 rgba(0,0,0,0.08);
    color: var(--text-secondary);
  }

  /* ─── Selectie + Achtergrond knoppen ─── */
  .select-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .select-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
    text-align: left;
    min-height: 84px;
  }
  .select-card:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-1);
  }
  .select-card:disabled {
    opacity: .45;
    cursor: not-allowed;
  }
  .select-card.active {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.15);
  }
  .select-swatch {
    width: 28px;
    height: 16px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
    margin-bottom: 4px;
  }
  .select-swatch.bg-swatch {
    width: 28px;
    height: 22px;
    background: linear-gradient(135deg, rgba(120,140,170,0.18), rgba(120,140,170,0.05));
    border: 1px dashed rgba(120,140,170,0.55);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    box-shadow: none;
  }
  .select-label {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .select-card.active .select-label {
    color: var(--mode-layout);
  }
  .select-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    line-height: 1.2;
  }

  /* ─── Achtergrond-paneel ─── */
  .bg-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 56px;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
    text-align: left;
  }
  .bg-toggle:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .bg-toggle.on {
    background: rgba(60, 130, 80, 0.06);
    border-color: rgba(60, 130, 80, 0.55);
    box-shadow: 0 0 0 2px rgba(60, 130, 80, 0.10);
  }
  .bg-toggle-icon {
    font-size: 20px;
    flex-shrink: 0;
  }
  .bg-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .bg-toggle-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .bg-toggle-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .bg-toggle-pill {
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.6px;
    background: var(--bg-sunken);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .bg-toggle.on .bg-toggle-pill {
    background: rgba(60, 130, 80, 0.18);
    color: rgb(40, 100, 60);
  }
  .bg-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .bg-action {
    flex: 1;
    min-height: 38px;
    padding: 0 var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .12s ease;
  }
  .bg-action:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--mode-layout);
  }
  .bg-action.danger {
    border-color: rgba(185, 28, 28, 0.45);
    color: rgb(150, 30, 30);
  }
  .bg-action.danger:hover:not(:disabled) {
    background: rgba(185, 28, 28, 0.06);
    border-color: rgb(185, 28, 28);
  }
  .bg-action:disabled {
    opacity: .4;
    cursor: not-allowed;
  }

  /* ── Schaal-presets ─────────────────────────────────── */
  .bg-presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: var(--space-2);
  }
  .bg-presets button {
    min-height: 28px;
    padding: 0 4px;
    font-size: 11px;
    font-weight: 700;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .12s ease;
  }
  .bg-presets button:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
  }
  .bg-presets button:disabled {
    opacity: .4;
    cursor: not-allowed;
  }

  /* ── Verplaats-pad (d-pad) ─────────────────────────── */
  .bg-nudge {
    margin-top: var(--space-3);
  }
  .bg-nudge-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;
  }
  .bg-nudge-title {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: 600;
  }
  .bg-step-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .bg-step {
    min-width: 32px;
    min-height: 26px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 700;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all .12s ease;
  }
  .bg-step:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .bg-step.active {
    background: rgba(194, 84, 10, 0.10);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
  }
  .bg-step:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
  .bg-step-label {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-left: 2px;
  }
  .bg-pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 36px);
    gap: 3px;
    max-width: 168px;
    margin: 0 auto;
  }
  .bg-pad-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    line-height: 1;
    transition: all .1s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .bg-pad-btn:hover:not(:disabled) {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
    transform: scale(1.04);
  }
  .bg-pad-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .bg-pad-btn:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
  .bg-pad-btn.c {
    background: var(--bg-sunken);
    color: var(--text-tertiary);
    font-size: 10px;
  }
  .bg-pad-btn.c:hover:not(:disabled) {
    background: rgba(194, 84, 10, 0.06);
  }
  .bg-opacity {
    display: block;
    margin-top: var(--space-3);
  }
  .bg-opacity-label {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .bg-opacity-val {
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .bg-opacity input[type="range"] {
    width: 100%;
    accent-color: var(--mode-layout);
  }
  .bg-opacity input[type="range"]:disabled {
    opacity: .4;
    cursor: not-allowed;
  }

  /* ─── Vaste structuren grid ─── */
  .struct-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-2);
  }
  .struct-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
    min-height: 80px;
    justify-content: center;
  }
  .struct-card:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-1);
  }
  .struct-card:active {
    transform: translateY(0);
  }
  .struct-card.active {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.15);
  }
  .struct-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .struct-label {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-primary);
    text-align: center;
    line-height: 1.1;
  }
  .struct-card.active .struct-label {
    color: var(--mode-layout);
  }

  /* ─── Penseelgrootte ─── */
  .brush-hero {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .brush-grid {
    display: grid;
    gap: 2px;
    width: 72px; height: 72px;
    padding: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .brush-cell {
    background: linear-gradient(135deg, var(--mode-layout), #8b3a06);
    border-radius: 2px;
  }
  .brush-meta { display: flex; flex-direction: column; gap: 2px; }
  .brush-dim {
    font-size: var(--text-lg);
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1;
  }
  .brush-cells {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .brush-row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    margin-bottom: 6px;
  }
  .brush-row-label {
    width: 48px;
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: 700;
  }
  .brush-input {
    flex: 1;
    height: 100%;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    -moz-appearance: textfield;
  }
  .brush-input::-webkit-outer-spin-button,
  .brush-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .brush-step {
    width: 36px;
    height: 36px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
    transition: all .12s ease;
  }
  .brush-step:hover:not(:disabled) {
    background: var(--bg-surface);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
  }
  .brush-step:disabled { opacity: .35; cursor: not-allowed; }
  .brush-presets {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    margin-top: var(--space-1);
  }
  .brush-presets button {
    height: 36px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .12s ease;
  }
  .brush-presets button:hover { background: var(--bg-sunken); }
  .brush-presets button.active {
    background: var(--mode-layout);
    color: #fff;
    border-color: var(--mode-layout);
  }

  /* ─── Aangepast vlak ─── */
  .custom-row {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }
  .custom-input-wrap {
    flex: 1;
  }
  .custom-text {
    width: 100%;
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
  .custom-text:focus {
    border-color: var(--mode-layout);
    background: var(--bg-surface);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.1);
  }
  .custom-text::placeholder {
    color: var(--text-tertiary);
  }
  .custom-color-wrap {
    position: relative;
    width: 40px;
    height: 40px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .custom-color-preview {
    display: block;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    border: 1.5px solid var(--border-subtle);
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);
    transition: border-color .12s;
  }
  .custom-color-wrap:hover .custom-color-preview {
    border-color: var(--border-strong);
  }
  .custom-color-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }
  .custom-paint-btn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
    transition: all .15s ease;
  }
  .custom-paint-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .custom-paint-btn.active {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    color: var(--mode-layout);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.15);
  }
  .custom-paint-swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
    flex-shrink: 0;
  }

  /* ─── Hulpmiddelen grid ─── */
  .tools-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .tool-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
    min-height: 72px;
    justify-content: center;
    text-align: center;
  }
  .tool-card:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-1);
  }
  .tool-card:active {
    transform: translateY(0);
  }
  .tool-card.active {
    background: rgba(194, 84, 10, 0.08);
    border-color: var(--mode-layout);
    box-shadow: 0 0 0 2px rgba(194, 84, 10, 0.15);
  }
  .tool-card.danger.active {
    background: rgba(185, 28, 28, 0.06);
    border-color: var(--accent-danger);
    box-shadow: 0 0 0 2px rgba(185, 28, 28, 0.12);
  }
  .tool-icon {
    font-size: 22px;
    line-height: 1;
  }
  .tool-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tool-name {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .tool-card.active .tool-name {
    color: var(--mode-layout);
  }
  .tool-card.danger.active .tool-name {
    color: var(--accent-danger);
  }
  .tool-status {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .tool-status.on {
    color: var(--accent-success);
  }

  /* ─── Wipe knop ─── */
  .wipe-btn {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--accent-danger);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--accent-danger);
    cursor: pointer;
    transition: all .15s ease;
  }
  .wipe-btn:hover {
    background: rgba(185, 28, 28, 0.06);
    border-color: var(--accent-danger);
  }

  /* ─── Losse selectie knop ─── */
  .pick-area-btn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-2);
    min-height: 56px;
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all .15s ease;
  }
  .pick-area-btn:hover {
    background: var(--bg-sunken);
    border-color: var(--border-strong);
  }
  .pick-area-btn.active {
    background: rgba(31, 111, 178, 0.08);
    border-color: #1F6FB2;
    box-shadow: 0 0 0 2px rgba(31, 111, 178, 0.15);
  }
  .pick-area-icon {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
  }
  .pick-area-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
  }
  .pick-area-title {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .pick-area-btn.active .pick-area-title {
    color: #1F6FB2;
  }
  .pick-area-sub {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
</style>
