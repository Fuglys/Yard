<script lang="ts">
  import { useStore } from '../useStore.svelte';
  import { zakPickerStore, traylijnStore, zakCodesStore, resolveZakLabel, materialForZakCode, toast } from '../stores/ui';
  import { cellsStore, upsertCells } from '../stores/state';
  import { schedulePush } from '../sync/engine';

  const z = useStore(zakPickerStore);
  const tl = useStore(traylijnStore);
  const cells = useStore(cellsStore);
  const codes = useStore(zakCodesStore);

  // Codes per TL-binding — het popover toont 3 secties: TL1, TL2, en "Los"
  // (geen TL). Volgorde van de codes is de volgorde uit de store.
  const tl1Codes = $derived(codes.value.filter((c) => c.tlLink === 'tl1').map((c) => c.code));
  const tl2Codes = $derived(codes.value.filter((c) => c.tlLink === 'tl2').map((c) => c.code));
  const losCodes = $derived(codes.value.filter((c) => c.tlLink === null).map((c) => c.code));

  // Resolve elke anchor in de selectie naar de daadwerkelijke ANCHOR-cel
  // (kan een non-anchor in zelfde 2×2 zijn — verschuif naar boven-links).
  const anchorCells = $derived.by(() => {
    if (!z.value) return [] as any[];
    const m = cells.value;
    const found: any[] = [];
    const seen = new Set<string>();
    for (const a of z.value.anchors) {
      const direct = m.get(`${a.col},${a.row}`);
      let target = null;
      if (direct?.cell_type === 'zak' && direct.meta?.zakAnchor) {
        target = direct;
      } else if (direct) {
        for (const [dc, dr] of [[-1, 0], [0, -1], [-1, -1]] as Array<[number, number]>) {
          const nb = m.get(`${a.col + dc},${a.row + dr}`);
          if (nb?.cell_type === 'zak' && nb.meta?.zakAnchor) { target = nb; break; }
        }
      }
      if (target) {
        const k = `${target.col},${target.row}`;
        if (!seen.has(k)) { seen.add(k); found.push(target); }
      }
    }
    return found;
  });

  const isMulti = $derived(anchorCells.length > 1);
  // Voor de header: gebruik de eerste anchor als referentie (single-mode) of
  // toon een teller (multi-mode). currentCode is alleen relevant in single-mode.
  const firstAnchor = $derived(anchorCells[0] ?? null);
  const currentCode = $derived<string>(
    isMulti ? '' : String(firstAnchor?.meta?.zakCode || '')
  );
  const resolvedNow = $derived(resolveZakLabel(currentCode, tl.value));
  // Rijen die in de selectie voorkomen — typisch 1 voor click, kan meer zijn bij drag.
  const rijLabels = $derived.by(() => {
    const set = new Set<string>();
    for (const a of anchorCells) {
      const r = a.meta?.zakRij ?? a.meta?.zakNum;
      if (r != null && r !== '') set.add(String(r));
    }
    return [...set];
  });
  const rijLabel = $derived(rijLabels[0] ?? '?');

  // Custom-mode: input voor een vrij in te vullen naam
  let customMode = $state(false);
  let customValue = $state('');
  // Verplaats-mode (alleen relevant bij gevulde anchors): doel-rij selectie
  let targetRij = $state('');
  $effect(() => {
    if (z.value) {
      customMode = false;
      customValue = '';
      targetRij = '';
    }
  });

  // Bevat de huidige selectie ten minste één gevulde zak? Bepaalt of de
  // Verplaatsen-sectie zichtbaar is.
  const hasFilled = $derived(anchorCells.some((a) => !!a.meta?.zakCode));
  const filledCount = $derived(anchorCells.filter((a) => !!a.meta?.zakCode).length);
  // Bron-rijen voor uitsluiting in de doel-dropdown
  const sourceRijenSet = $derived.by(() => {
    const s = new Set<string>();
    for (const a of anchorCells) {
      if (!a.meta?.zakCode) continue;
      const r = a.meta?.zakRij ?? a.meta?.zakNum;
      if (r != null && r !== '') s.add(String(r));
    }
    return s;
  });
  const beschikbareRijen = $derived.by(() => {
    if (!hasFilled) return [] as string[];
    const set = new Set<string>();
    for (const c of cells.value.values()) {
      if (c.cell_type !== 'zak' || !c.meta?.zakAnchor) continue;
      const r = c.meta?.zakRij ?? c.meta?.zakNum;
      if (r === undefined || r === null || r === '') continue;
      const key = String(r);
      if (sourceRijenSet.has(key)) continue;
      set.add(key);
    }
    return [...set].sort((a, b) => {
      const an = Number(a), bn = Number(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
  });

  async function pick(code: string | null) {
    const list = anchorCells;
    if (list.length === 0) return;
    const ts = Date.now();
    const cellsMap = cells.value;

    // Bepaal doel-anchors:
    //  - Single anchor + wissen, OF single anchor met bestaande code  → bewerk in-place
    //  - Anders (placement op lege selectie): redirect naar de BOVENSTE vrije
    //    plekken in elke geselecteerde rij. De gebruiker kan dus op de
    //    onderste cel klikken; het materiaal landt automatisch bovenin.
    let targets: any[];
    const editInPlace =
      list.length === 1 && (code === null || !!list[0].meta?.zakCode);

    if (editInPlace) {
      targets = [list[0]];
    } else {
      // Groepeer selectie per rij-id
      const selByRij = new Map<string, any[]>();
      for (const a of list) {
        const key = String(a.meta?.zakRij ?? a.meta?.zakNum ?? '');
        if (!selByRij.has(key)) selByRij.set(key, []);
        selByRij.get(key)!.push(a);
      }
      targets = [];
      for (const [rijKey, selectedInRij] of selByRij) {
        const orient = (selectedInRij[0].meta?.zakOrient || 'h') as 'h' | 'v';
        // Verzamel alle anchors van die rij + sorteer top-down
        const allInRij: any[] = [];
        for (const c of cellsMap.values()) {
          if (c.cell_type !== 'zak' || !c.meta?.zakAnchor) continue;
          const r = String(c.meta?.zakRij ?? c.meta?.zakNum ?? '');
          if (r !== rijKey) continue;
          allInRij.push(c);
        }
        allInRij.sort((a, b) => (orient === 'h' ? a.row - b.row : a.col - b.col));
        const freeInRij = allInRij.filter((c) => !c.meta?.zakCode);
        const need = selectedInRij.length;
        for (let i = 0; i < Math.min(need, freeInRij.length); i++) {
          targets.push(freeInRij[i]);
        }
      }
    }

    if (targets.length === 0) { close(); return; }

    // Bevries de TL-materiaalnaam zoals die nu is — zo verandert het label
    // op deze zak NIET meer mee als de gebruiker later TL1/TL2 wijzigt.
    const stampMaterial = code ? materialForZakCode(code, tl.value) : null;

    const upserts = targets.map((a) => ({
      col: a.col, row: a.row,
      cell_type: a.cell_type,
      area_id: a.area_id ?? null,
      label: a.label || '',
      meta: { ...(a.meta || {}), zakCode: code || null, zakMaterial: stampMaterial },
      updated_at: ts,
    }));
    await upsertCells(upserts);
    schedulePush();
    const n = upserts.length;
    if (code) {
      const resolved = resolveZakLabel(code, tl.value) || code;
      toast(n > 1 ? `${n} zakken → ${resolved}` : resolved);
    } else {
      toast(n > 1 ? `${n} zakken gewist` : 'Materiaal gewist');
    }
    close();
  }

  async function pickCustom() {
    const name = customValue.trim();
    if (!name) return;
    await pick(name);
  }

  // Verplaats de gevulde zakken in de selectie naar de bovenste vrije plekken
  // van de gekozen doel-rij. Lege zakken in de selectie worden genegeerd.
  // Bron-codes worden gewist, geen target-codes worden overschreven.
  async function verplaats() {
    if (!targetRij) return;
    const sourceFilled = anchorCells.filter((a) => !!a.meta?.zakCode);
    if (sourceFilled.length === 0) { close(); return; }
    const orient = (sourceFilled[0].meta?.zakOrient === 'v' ? 'v' : 'h') as 'h' | 'v';
    const cellsMap = cells.value;

    // Bron op stapel-volgorde van BOVEN naar onder
    const sourceSorted = [...sourceFilled].sort((a, b) =>
      orient === 'h' ? a.row - b.row : a.col - b.col
    );
    // Bewaar bron-code + bevroren zakMaterial samen, zodat de
    // verhuisde zak het oorspronkelijke materiaal-label houdt.
    const sourceStamps = sourceSorted
      .map((a) => ({
        code: String(a.meta?.zakCode || ''),
        material: (a.meta?.zakMaterial as string | null | undefined) ?? null,
      }))
      .filter((s) => !!s.code);
    if (sourceStamps.length === 0) { close(); return; }

    // Doel: alle anchors van de gekozen rij, top-down + alleen lege
    const allInTarget: any[] = [];
    for (const c of cellsMap.values()) {
      if (c.cell_type !== 'zak' || !c.meta?.zakAnchor) continue;
      const r = String(c.meta?.zakRij ?? c.meta?.zakNum ?? '');
      if (r !== targetRij) continue;
      allInTarget.push(c);
    }
    if (allInTarget.length === 0) {
      toast(`Rij ${targetRij} heeft geen zakken`);
      return;
    }
    allInTarget.sort((a, b) => (orient === 'h' ? a.row - b.row : a.col - b.col));
    const freeTargets = allInTarget.filter((c) => !c.meta?.zakCode);
    if (freeTargets.length < sourceStamps.length) {
      toast(
        `Rij ${targetRij} heeft maar ${freeTargets.length} vrije plek` +
        `${freeTargets.length === 1 ? '' : 'ken'} — ${sourceStamps.length} nodig. Niets verplaatst.`
      );
      return;
    }

    const ts = Date.now();
    const upserts: any[] = [];
    // Schrijf bron-stamp (code + bevroren materiaal) naar doel
    for (let i = 0; i < sourceStamps.length; i++) {
      const t = freeTargets[i];
      upserts.push({
        col: t.col, row: t.row,
        cell_type: t.cell_type,
        area_id: t.area_id ?? null,
        label: '',
        meta: {
          ...(t.meta || {}),
          zakCode: sourceStamps[i].code,
          zakMaterial: sourceStamps[i].material,
        },
        updated_at: ts,
      });
    }
    // Wis bron-stamps (code + materiaal)
    for (const a of sourceSorted) {
      upserts.push({
        col: a.col, row: a.row,
        cell_type: a.cell_type,
        area_id: a.area_id ?? null,
        label: a.label || '',
        meta: { ...(a.meta || {}), zakCode: null, zakMaterial: null },
        updated_at: ts,
      });
    }
    await upsertCells(upserts);
    schedulePush();
    toast(`${sourceStamps.length} zak${sourceStamps.length === 1 ? '' : 'ken'} verplaatst naar Rij ${targetRij}`);
    close();
  }

  function close() { zakPickerStore.set(null); }
  function onKey(e: KeyboardEvent) {
    if (z.value == null) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if z.value && anchorCells.length > 0}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <div>
          <div class="hd-type">Zak{isMulti ? ' — meerdere' : ''}</div>
          <div class="hd-name">
            {#if isMulti}
              {anchorCells.length} zakken
            {:else}
              Rij {rijLabel}
            {/if}
          </div>
          <div class="hd-sub">
            {#if isMulti}
              {#if rijLabels.length === 1}Rij {rijLabels[0]}{:else if rijLabels.length > 1}{rijLabels.length} rijen{/if}
            {:else}
              {resolvedNow || 'Geen materiaal'}
            {/if}
          </div>
        </div>
        <button class="x" onclick={close} aria-label="Sluiten">×</button>
      </div>

      <div class="body">
        <div class="tl-line">
          <span class="tl-pill"><strong>TL1</strong> {tl.value.tl1 || '—'}</span>
          <span class="tl-pill"><strong>TL2</strong> {tl.value.tl2 || '—'}</span>
        </div>

        {#if tl1Codes.length > 0}
          <div class="grid-section">
            <div class="grid-label">TL1 <em>{tl.value.tl1 || '(geen materiaal)'}</em></div>
            <div class="grid">
              {#each tl1Codes as code (code)}
                <button class="zk-btn s" class:active={currentCode === code} onclick={() => pick(code)}>
                  <span class="zk-code">{code}</span>
                  {#if tl.value.tl1}<span class="zk-resolved">{tl.value.tl1}</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if tl2Codes.length > 0}
          <div class="grid-section">
            <div class="grid-label">TL2 <em>{tl.value.tl2 || '(geen materiaal)'}</em></div>
            <div class="grid">
              {#each tl2Codes as code (code)}
                <button class="zk-btn t" class:active={currentCode === code} onclick={() => pick(code)}>
                  <span class="zk-code">{code}</span>
                  {#if tl.value.tl2}<span class="zk-resolved">{tl.value.tl2}</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if losCodes.length > 0}
          <div class="grid-section">
            <div class="grid-label">Los <em>(geen TL-koppeling)</em></div>
            <div class="grid">
              {#each losCodes as code (code)}
                <button class="zk-btn n" class:active={currentCode === code} onclick={() => pick(code)}>
                  <span class="zk-code">{code}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="grid-section">
          <div class="grid-label">Custom</div>
          {#if customMode}
            <div class="custom-row">
              <input
                class="custom-input"
                type="text"
                bind:value={customValue}
                placeholder="Eigen naam (bv. KLM-batch)"
                maxlength="20"
                autocomplete="off"
                onkeydown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); pickCustom(); }
                  else if (e.key === 'Escape') { e.preventDefault(); customMode = false; customValue = ''; }
                }}
              />
              <button class="btn primary small" onclick={pickCustom} disabled={!customValue.trim()}>OK</button>
              <button class="btn small" onclick={() => { customMode = false; customValue = ''; }}>×</button>
            </div>
          {:else}
            <button class="zk-btn c full" onclick={() => { customMode = true; }}>
              <span class="zk-code">✏ Eigen naam invullen…</span>
            </button>
          {/if}
        </div>

        {#if hasFilled}
          <div class="grid-section move-section">
            <div class="grid-label">Verplaatsen</div>
            <div class="move-row">
              <select class="move-select" bind:value={targetRij}>
                <option value="">— kies rij —</option>
                {#each beschikbareRijen as r (r)}
                  <option value={r}>Rij {r}</option>
                {/each}
              </select>
              <button class="btn primary small" onclick={verplaats} disabled={!targetRij}>
                {filledCount > 1 ? `Verplaats ${filledCount}` : 'Verplaatsen'}
              </button>
            </div>
          </div>
        {/if}

        <div class="actions">
          <button class="btn danger" onclick={() => pick(null)} disabled={anchorCells.length === 1 ? !currentCode : !hasFilled}>
            🗑 {filledCount > 1 ? `Wissen (${filledCount})` : 'Wissen'}
          </button>
          <button class="btn" onclick={close}>Annuleren</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1500;
    background: rgba(15,23,42,0.4);
    display: flex; align-items: flex-end; justify-content: center;
    backdrop-filter: blur(3px);
    animation: fadeIn .15s;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  .panel {
    background: var(--bg-surface);
    width: 100%; max-width: 480px;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-4);
    overflow: hidden;
    animation: slideUp .2s cubic-bezier(.2,.9,.3,1);
    max-height: 80vh;
    display: flex; flex-direction: column;
  }
  @keyframes slideUp { from { transform: translateY(40px); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
  @media (min-width: 720px) {
    .overlay { align-items: center; padding: 20px; }
    .panel { border-radius: var(--radius-xl); }
  }

  .head {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 14px 20px 16px;
    background: #0E7490;
    color: #fff;
    gap: 12px;
    flex-shrink: 0;
  }
  .hd-type { font-size: 10px; opacity: .85; text-transform: uppercase; letter-spacing: .5px; font-weight: 700; }
  .hd-name { font-size: 18px; font-weight: 700; margin-top: 2px; line-height: 1.15; }
  .hd-sub { font-size: 13px; margin-top: 4px; opacity: .9; font-weight: 600; }
  .x {
    background: rgba(255,255,255,0.2); border: 0;
    width: 32px; height: 32px; border-radius: 50%;
    color: #fff; font-size: 20px;
    cursor: pointer; flex-shrink: 0;
  }
  .x:hover { background: rgba(255,255,255,0.3); }

  .body { padding: 16px 20px 20px; overflow-y: auto; }

  .tl-line { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .tl-pill {
    background: #f0f2f5; border-radius: 8px;
    padding: 6px 10px; font-size: 12px; color: #2c3e50;
    display: inline-flex; align-items: baseline; gap: 6px;
  }
  .tl-pill strong { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .4px; }

  .grid-section { margin-bottom: 14px; }
  .grid-label {
    font-size: 11px; font-weight: 700; color: #94a3b8;
    text-transform: uppercase; letter-spacing: .4px;
    margin-bottom: 6px;
  }
  .grid-label em { font-style: normal; color: #2c3e50; font-weight: 600; text-transform: none; letter-spacing: 0; }

  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .grid-2 { grid-template-columns: repeat(2, 1fr); }

  .zk-btn {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 50px; padding: 6px;
    border: 1.5px solid #d5d8dc;
    background: #fff;
    border-radius: 8px;
    cursor: pointer;
    transition: all .12s;
    font-family: inherit;
  }
  .zk-btn:hover { border-color: #2e86c1; background: #f7f9fc; }
  .zk-btn.active {
    border-color: #2e86c1; background: rgba(46,134,193,0.12);
    box-shadow: inset 0 0 0 1px #2e86c1;
  }
  .zk-btn.s { border-left-width: 4px; border-left-color: #2980b9; }
  .zk-btn.t { border-left-width: 4px; border-left-color: #c0392b; }
  .zk-btn.n { border-left-width: 4px; border-left-color: #7f8c8d; }
  .zk-btn.g { border-left-width: 4px; border-left-color: #d4b896; }
  .zk-btn.c { border-left-width: 4px; border-left-color: #8e44ad; }
  .zk-btn.full { width: 100%; }

  .move-section { background: #f7f9fc; padding: 10px; border-radius: 8px; border: 1px solid #e2e6ea; }
  .move-row { display: flex; gap: 6px; align-items: center; }
  .move-select {
    flex: 1; min-height: 40px;
    padding: 0 10px;
    border: 1.5px solid #d5d8dc;
    border-radius: 8px;
    font-size: 13px; font-weight: 700; color: #2c3e50;
    background: #fff;
    outline: none;
    font-family: inherit;
  }
  .move-select:focus { border-color: #2e86c1; }

  .custom-row { display: flex; gap: 6px; align-items: center; }
  .custom-input {
    flex: 1; min-height: 40px;
    padding: 0 10px;
    border: 1.5px solid #d5d8dc;
    border-radius: 8px;
    font-size: 14px; font-weight: 600;
    color: #2c3e50;
    background: #fff;
    outline: none;
    font-family: inherit;
  }
  .custom-input:focus { border-color: #2e86c1; }
  .btn.small { min-height: 40px; min-width: 40px; flex: 0 0 auto; padding: 0 10px; }
  .btn.primary {
    background: #2e86c1; color: #fff; border-color: #1f6391;
  }
  .btn.primary:hover:not(:disabled) { background: #1f6391; }
  .zk-code { font-size: 13px; font-weight: 700; color: #2c3e50; }
  .zk-resolved { font-size: 10px; font-weight: 600; color: #94a3b8; margin-top: 1px; }

  .actions {
    display: flex; gap: 8px; margin-top: 6px;
    border-top: 1px solid #e2e6ea; padding-top: 12px;
  }
  .btn {
    flex: 1; min-height: 44px;
    border: 1px solid #d5d8dc;
    background: #fff;
    border-radius: 8px;
    font-size: 13px; font-weight: 700; color: #2c3e50;
    cursor: pointer;
    transition: background .12s;
    font-family: inherit;
  }
  .btn:hover:not(:disabled) { background: #f7f9fc; }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .btn.danger { background: #e74c3c; color: #fff; border-color: #c0392b; }
  .btn.danger:hover:not(:disabled) { background: #c0392b; }
</style>
