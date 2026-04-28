<script lang="ts">
  import { useStore } from '../useStore.svelte';
  import { zakMultiSelectStore, traylijnStore, resolveZakLabel, toast } from '../stores/ui';
  import { cellsStore, upsertCells } from '../stores/state';
  import { schedulePush } from '../sync/engine';

  const sel = useStore(zakMultiSelectStore);
  const tl = useStore(traylijnStore);
  const cells = useStore(cellsStore);

  let targetRij = $state('');

  // Reset target wanneer popover opnieuw opent
  $effect(() => {
    if (sel.value) {
      targetRij = '';
    }
  });

  // Aantal anchors met materiaal (voor de Verwijderen-knop label).
  const filledCount = $derived(
    (sel.value?.anchors ?? []).filter((a) => !!a.zakCode).length
  );

  // Lijst van beschikbare rijen (uit alle zak-anchors in de yard).
  // Sluit de bron-rij(en) uit zodat de gebruiker niet naar zichzelf verplaatst.
  const sourceRijen = $derived(new Set((sel.value?.anchors ?? []).map((a) => a.zakRij).filter((r) => !!r)));
  const beschikbareRijen = $derived.by(() => {
    if (!sel.value) return [] as string[];
    const set = new Set<string>();
    for (const c of cells.value.values()) {
      if (c.cell_type !== 'zak' || !c.meta?.zakAnchor) continue;
      const r = c.meta?.zakRij ?? c.meta?.zakNum;
      if (r === undefined || r === null || r === '') continue;
      const key = String(r);
      if (sourceRijen.has(key)) continue;
      set.add(key);
    }
    return [...set].sort((a, b) => {
      const an = Number(a), bn = Number(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
  });

  // Materialen-overzicht voor de header van de popup
  const codeCount = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of sel.value?.anchors ?? []) {
      const k = a.zakCode || '(leeg)';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()];
  });

  function close() { zakMultiSelectStore.set(null); }
  function onKey(e: KeyboardEvent) {
    if (sel.value == null) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // Verwijder alle materiaal-codes uit de geselecteerde zak-anchors. De
  // anchors zelf blijven bestaan (zak-blokken in de yard wijzigen niet),
  // alleen hun zakCode wordt gewist zodat ze weer leeg/grijs renderen.
  async function verwijder() {
    const s = sel.value;
    if (!s || s.anchors.length === 0) { close(); return; }
    const cellsMap = cellsStore.get();
    const ts = Date.now();
    const upserts: any[] = [];
    let cleared = 0;
    for (const a of s.anchors) {
      if (!a.zakCode) continue;
      const orig = cellsMap.get(`${a.col},${a.row}`);
      if (!orig) continue;
      upserts.push({
        col: orig.col, row: orig.row,
        cell_type: orig.cell_type,
        area_id: orig.area_id ?? null,
        label: orig.label || '',
        meta: { ...(orig.meta || {}), zakCode: null, zakMaterial: null },
        updated_at: ts,
      });
      cleared++;
    }
    if (cleared === 0) {
      toast('Geen materiaal om te verwijderen');
      close();
      return;
    }
    await upsertCells(upserts);
    schedulePush();
    toast(`${cleared} zak${cleared === 1 ? '' : 'ken'} gewist`);
    close();
  }

  async function verplaats() {
    const s = sel.value;
    if (!s || !targetRij) return;
    const sourceAnchors = s.anchors;
    if (sourceAnchors.length === 0) { close(); return; }
    const orient = sourceAnchors[0].zakOrient;
    const cellsMap = cellsStore.get();

    // Bron op stapel-volgorde van BOVEN naar onder: orient='h' lage row
    // eerst, orient='v' lage col eerst. We willen de bovenste bron-code in
    // de bovenste vrije doel-plek terecht laten komen.
    const sourceSorted = [...sourceAnchors].sort((a, b) =>
      orient === 'h' ? a.row - b.row : a.col - b.col
    );
    // Bewaar bron-code samen met het bevroren zakMaterial uit de cel-meta —
    // het verplaatst-label moet hetzelfde blijven, ook als TL1/TL2 sindsdien
    // is gewijzigd.
    const sourceStamps = sourceSorted
      .map((a) => {
        const orig = cellsMap.get(`${a.col},${a.row}`);
        return {
          code: a.zakCode,
          material: (orig?.meta?.zakMaterial as string | null | undefined) ?? null,
        };
      })
      .filter((s) => !!s.code);

    if (sourceStamps.length === 0) {
      toast('Geen materiaal om te verplaatsen');
      return;
    }

    // Doel-rij: alle anchors zoeken, op dezelfde manier sorteren.
    type TargetAnchor = {
      col: number; row: number;
      meta: any; cell_type: string;
      area_id: number | string | null;
      hasCode: boolean;
    };
    const targetAnchors: TargetAnchor[] = [];
    for (const c of cellsMap.values()) {
      if (c.cell_type !== 'zak' || !c.meta?.zakAnchor) continue;
      const r = String(c.meta?.zakRij ?? c.meta?.zakNum ?? '');
      if (r !== targetRij) continue;
      targetAnchors.push({
        col: c.col, row: c.row,
        meta: c.meta || {},
        cell_type: c.cell_type,
        area_id: c.area_id ?? null,
        hasCode: !!c.meta?.zakCode,
      });
    }
    if (targetAnchors.length === 0) {
      toast(`Rij ${targetRij} heeft geen zakken`);
      return;
    }
    // Doel ook van BOVEN naar onder sorteren — zo wordt de eerste vrije
    // plek bovenin gevuld i.p.v. onderin. Gebruiker wil verhuisde zakken
    // altijd bovenaan de doel-rij hebben.
    const targetSorted = targetAnchors.sort((a, b) =>
      orient === 'h' ? a.row - b.row : a.col - b.col
    );

    // Alleen LEGE doel-anchors zijn beschikbaar — bestaande codes worden NIET
    // overschreven. Bron-codes worden vanaf onder/rechts in de eerste vrije
    // plek in stapel-volgorde gezet (dus "boven" eventuele bestaande codes
    // als die onderaan staan; in vrije plekken in volgorde anders).
    const freeTargets = targetSorted.filter((t) => !t.hasCode);
    if (freeTargets.length < sourceStamps.length) {
      toast(
        `Rij ${targetRij} heeft maar ${freeTargets.length} vrije plek` +
        `${freeTargets.length === 1 ? '' : 'ken'} — ${sourceStamps.length} nodig. ` +
        `Niets verplaatst.`
      );
      return;
    }

    const ts = Date.now();
    const upserts: any[] = [];
    for (let i = 0; i < sourceStamps.length; i++) {
      const t = freeTargets[i];
      upserts.push({
        col: t.col, row: t.row,
        cell_type: t.cell_type,
        area_id: t.area_id,
        label: '',
        meta: {
          ...t.meta,
          zakCode: sourceStamps[i].code,
          zakMaterial: sourceStamps[i].material,
        },
        updated_at: ts,
      });
    }
    // Wis bron-codes + zakMaterial (alleen anchors die een code hadden;
    // anchors zonder code blijven onaangeroerd).
    for (const a of sourceAnchors) {
      if (!a.zakCode) continue;
      const orig = cellsMap.get(`${a.col},${a.row}`);
      if (!orig) continue;
      upserts.push({
        col: orig.col, row: orig.row,
        cell_type: orig.cell_type,
        area_id: orig.area_id ?? null,
        label: orig.label || '',
        meta: { ...(orig.meta || {}), zakCode: null, zakMaterial: null },
        updated_at: ts,
      });
    }
    await upsertCells(upserts);
    schedulePush();
    toast(`${sourceStamps.length} zak(ken) verplaatst naar Rij ${targetRij}`);
    close();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if sel.value}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <div>
          <div class="hd-type">Multi-selectie</div>
          <div class="hd-name">{sel.value.anchors.length} zak{sel.value.anchors.length === 1 ? '' : 'ken'} geselecteerd</div>
          <div class="hd-sub">
            {#if sourceRijen.size === 1}
              Rij {[...sourceRijen][0]}
            {:else if sourceRijen.size > 1}
              {sourceRijen.size} rijen
            {/if}
          </div>
        </div>
        <button class="x" onclick={close} aria-label="Sluiten">×</button>
      </div>

      <div class="body">
        <div class="codes-row">
          {#each codeCount as [code, n] (code)}
            <span class="code-pill" class:empty={code === '(leeg)'}>
              {#if code === '(leeg)'}
                — leeg
              {:else}
                {resolveZakLabel(code, tl.value) || code}
              {/if}
              <strong>{n}×</strong>
            </span>
          {/each}
        </div>

        <hr />

        <label class="row-pick">
          <span class="row-pick-label">Verplaatsen naar Rij</span>
          <select bind:value={targetRij}>
            <option value="">— kies rij —</option>
            {#each beschikbareRijen as r (r)}
              <option value={r}>Rij {r}</option>
            {/each}
          </select>
        </label>

        <div class="actions">
          <button
            class="btn danger"
            onclick={verwijder}
            disabled={filledCount === 0}
            title={filledCount === 0 ? 'Geen materiaal in selectie' : `${filledCount} zak(ken) leegmaken`}
          >🗑 Verwijder{filledCount > 1 ? ` ${filledCount}` : ''}</button>
          <button class="btn" onclick={close}>Annuleren</button>
          <button class="btn primary" onclick={verplaats} disabled={!targetRij}>Verplaatsen</button>
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
    width: 100%; max-width: 420px;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-4);
    overflow: hidden;
    animation: slideUp .2s cubic-bezier(.2,.9,.3,1);
  }
  @keyframes slideUp { from { transform: translateY(40px); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
  @media (min-width: 720px) {
    .overlay { align-items: center; padding: 20px; }
    .panel { border-radius: var(--radius-xl); }
  }

  .head {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 14px 18px 16px;
    background: #2c3e50;
    color: #fff;
    gap: 10px;
  }
  .hd-type { font-size: 10px; opacity: .85; text-transform: uppercase; letter-spacing: .5px; font-weight: 700; }
  .hd-name { font-size: 17px; font-weight: 700; margin-top: 2px; }
  .hd-sub { font-size: 12px; margin-top: 4px; opacity: .85; font-weight: 600; }
  .x {
    background: rgba(255,255,255,0.2); border: 0;
    width: 30px; height: 30px; border-radius: 50%;
    color: #fff; font-size: 18px;
    cursor: pointer;
  }
  .x:hover { background: rgba(255,255,255,0.3); }

  .body { padding: 16px 18px 18px; }

  .codes-row {
    display: flex; gap: 6px; flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .code-pill {
    background: #f0f2f5; border-radius: 7px;
    padding: 5px 10px; font-size: 12px; font-weight: 600; color: #2c3e50;
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .code-pill.empty { color: #94a3b8; font-style: italic; }
  .code-pill strong { font-weight: 800; color: #2c3e50; }

  hr { border: 0; border-top: 1px solid #e2e6ea; margin: 12px 0; }

  .row-pick { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .row-pick-label {
    font-size: 11px; font-weight: 700; color: #94a3b8;
    text-transform: uppercase; letter-spacing: .4px;
  }
  .row-pick select {
    height: 40px; padding: 0 12px;
    border: 1px solid #d5d8dc; border-radius: 8px;
    font-size: 14px; font-weight: 700; color: #2c3e50;
    background: #fff;
  }
  .row-pick select:focus { outline: 2px solid #2e86c1; outline-offset: 1px; }

  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    flex: 1; min-height: 44px;
    min-width: 90px;
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
  .btn.primary { background: #2e86c1; color: #fff; border-color: #1f6391; }
  .btn.primary:hover:not(:disabled) { background: #1f6391; }
  .btn.danger { background: #e74c3c; color: #fff; border-color: #c0392b; }
  .btn.danger:hover:not(:disabled) { background: #c0392b; }
  .confirm-row {
    flex: 1;
    display: flex; align-items: center; gap: 8px;
    flex-wrap: wrap;
    background: #fdebec;
    border: 1px solid #f5b7b1;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px; font-weight: 700; color: #c0392b;
  }
  .confirm-row span { flex: 1; min-width: 140px; }
  .confirm-row .btn { flex: 0 0 auto; min-width: 60px; min-height: 36px; }
</style>
