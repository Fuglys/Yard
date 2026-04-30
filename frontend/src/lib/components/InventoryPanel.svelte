<script lang="ts">
  import { cellsStore, areasStore } from '../stores/state';
  import { inventoryPanelOpen, zakCodesStore, stripMaterialTLSuffix } from '../stores/ui';
  import { useStore } from '../useStore.svelte';

  const cells = useStore(cellsStore);
  const areas = useStore(areasStore);
  const codes = useStore(zakCodesStore);
  const open = useStore(inventoryPanelOpen);

  // ── Aggregaties ──────────────────────────────────────────────────
  // Zakken: tel per (zakCode, zakMaterial) op basis van zak-anchors.
  // Materiaal-display zonder trailing " S"/" T" — die info zit al in de code.
  // Zakken zonder zakCode (oude data, niet via picker geplaatst) tellen NIET
  // mee — die hebben geen betekenis voor dit overzicht.
  const zakAgg = $derived.by(() => {
    const m = new Map<string, { total: number; byMaterial: Map<string | null, number> }>();
    for (const c of cells.value.values()) {
      if (c.cell_type !== 'zak') continue;
      if (!c.meta?.zakAnchor) continue;
      const code = (c.meta.zakCode as string) || '';
      if (!code) continue;
      const rawMat = (c.meta.zakMaterial as string) || null;
      const material = rawMat ? (stripMaterialTLSuffix(rawMat) || null) : null;
      let bucket = m.get(code);
      if (!bucket) { bucket = { total: 0, byMaterial: new Map() }; m.set(code, bucket); }
      bucket.total++;
      bucket.byMaterial.set(material, (bucket.byMaterial.get(material) || 0) + 1);
    }
    return m;
  });

  // Balen: som van metadata.quantity per material_name, alleen bunkers met
  // minstens 1 echte cel — anders tellen orphan-areas (cellen weg, area
  // niet opgeruimd) ook mee. Display-naam zonder trailing " S"/" T".
  const balenAgg = $derived.by(() => {
    // Welke area_ids komen voor in cells?
    const liveAreaIds = new Set<number | string>();
    for (const c of cells.value.values()) {
      if (c.area_id != null) liveAreaIds.add(c.area_id);
    }
    const m = new Map<string, { partijen: number; areas: number }>();
    for (const a of areas.value.values()) {
      if (a.area_type !== 'bunker') continue;
      if (!a.material_name) continue;
      if (!liveAreaIds.has(a.id)) continue;
      const display = stripMaterialTLSuffix(a.material_name);
      if (!display) continue;
      const qty = Number(a.metadata?.quantity) || 0;
      let bucket = m.get(display);
      if (!bucket) { bucket = { partijen: 0, areas: 0 }; m.set(display, bucket); }
      bucket.partijen += qty;
      bucket.areas++;
    }
    return m;
  });

  // ── Sortering & groepering ─────────────────────────────────────
  // Zakken gegroepeerd op eerste letter van de code:
  //   - codes die beginnen met 'S' → Traylijn 1
  //   - codes die beginnen met 'T' → Traylijn 2
  //   - alles anders (Granulaat etc.) → Overig
  // Binnen elke groep: volgorde van zakCodesStore (config), dan onbekende.
  type TLGroup = { key: 'tl1' | 'tl2' | 'other'; label: string; codes: string[] };
  const groupedZakCodes = $derived.by(() => {
    const order = codes.value.map((c) => c.code);
    const seen = new Set(order);
    const tl1: string[] = [];
    const tl2: string[] = [];
    const other: string[] = [];
    const bucketFor = (code: string): string[] => {
      const ch = (code[0] || '').toUpperCase();
      if (ch === 'S') return tl1;
      if (ch === 'T') return tl2;
      return other;
    };
    for (const code of order) {
      if (!zakAgg.has(code)) continue;
      bucketFor(code).push(code);
    }
    for (const code of zakAgg.keys()) {
      if (seen.has(code)) continue;
      bucketFor(code).push(code);
    }
    const groups: TLGroup[] = [];
    if (tl1.length) groups.push({ key: 'tl1', label: 'Traylijn 1', codes: tl1 });
    if (tl2.length) groups.push({ key: 'tl2', label: 'Traylijn 2', codes: tl2 });
    if (other.length) groups.push({ key: 'other', label: 'Overig', codes: other });
    return groups;
  });

  // Balen op partijen aflopend, alleen rijen met partijen > 0 OF areas > 0.
  const orderedBalenMaterials = $derived.by(() => {
    return [...balenAgg.entries()]
      .filter(([, v]) => v.partijen > 0 || v.areas > 0)
      .sort((a, b) => b[1].partijen - a[1].partijen)
      .map(([k]) => k);
  });

  function sortedMaterials(byMaterial: Map<string | null, number>): Array<[string | null, number]> {
    return [...byMaterial.entries()].sort((a, b) => {
      // null (geen materiaal) onderaan
      if (a[0] === null && b[0] !== null) return 1;
      if (b[0] === null && a[0] !== null) return -1;
      return String(a[0]).localeCompare(String(b[0]));
    });
  }

  function toggle() { inventoryPanelOpen.set(!open.value); }
  function close() { inventoryPanelOpen.set(false); }

  // Klik buiten paneel sluit het.
  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

{#if open.value}
  <div class="backdrop" onclick={onBackdropClick} role="presentation"></div>
{/if}

<button
  type="button"
  class="tab"
  class:open={open.value}
  onclick={toggle}
  aria-label={open.value ? 'Voorraad sluiten' : 'Voorraad openen'}
>
  <span class="chevron">{open.value ? '›' : '‹'}</span>
  <span class="tab-label">Voorraad</span>
</button>

<aside class="panel" class:open={open.value} aria-hidden={!open.value}>
  <header class="panel-header">
    <h2>Voorraad</h2>
  </header>

  <div class="panel-body">
    <section>
      <h3>Zakken</h3>
      {#if groupedZakCodes.length === 0}
        <p class="empty">Geen zakken geplaatst</p>
      {:else}
        {#each groupedZakCodes as group (group.key)}
          <div class="tl-group">
            <h4 class="tl-heading">{group.label}</h4>
            <ul class="rows">
              {#each group.codes as code (code)}
                {@const bucket = zakAgg.get(code)!}
                {@const mats = sortedMaterials(bucket.byMaterial)}
                {@const showMats = mats.length > 1 || (mats.length === 1 && mats[0][0] !== null)}
                <li class="row code-row">
                  <span class="label">{code}</span>
                  <span class="num">{bucket.total} zk</span>
                </li>
                {#if showMats}
                  {#each mats as [mat, n] (mat ?? '__null__')}
                    {#if mat !== null}
                      <li class="row mat-row">
                        <span class="label">{mat}</span>
                        <span class="num">{n}</span>
                      </li>
                    {/if}
                  {/each}
                {/if}
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </section>

    <section>
      <h3>Balen</h3>
      {#if orderedBalenMaterials.length === 0}
        <p class="empty">Geen balen geplaatst</p>
      {:else}
        <ul class="rows">
          {#each orderedBalenMaterials as mat (mat)}
            {@const v = balenAgg.get(mat)!}
            <li class="row code-row">
              <span class="label">{mat}</span>
              <span class="num">{v.partijen} partijen</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</aside>

<style>
  .tab {
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    z-index: 95;
    background: #2c3e50;
    color: #fff;
    border: none;
    border-radius: 8px 0 0 8px;
    padding: 14px 6px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    box-shadow: -2px 2px 6px rgba(0,0,0,0.18);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
    transition: right 220ms ease;
  }
  .tab.open { right: 560px; }
  .tab:hover { background: #34495e; }
  .tab-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    text-transform: uppercase;
  }
  .chevron { font-size: 16px; line-height: 1; }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: transparent;
  }

  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 560px;
    background: #fff;
    border-left: 1px solid #d5dbdb;
    box-shadow: -4px 0 12px rgba(0,0,0,0.10);
    transform: translateX(100%);
    transition: transform 220ms ease;
    z-index: 94;
    display: flex;
    flex-direction: column;
  }
  .panel.open { transform: translateX(0); }

  .panel-header {
    padding: 14px 16px;
    border-bottom: 1px solid #ecf0f1;
    background: #f8f9fa;
  }
  .panel-header h2 {
    margin: 0;
    font-size: 16px;
    color: #2c3e50;
  }

  .panel-body {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    overflow: hidden;
    min-height: 0;
  }

  section {
    padding: 8px 0;
    overflow-y: auto;
    min-height: 0;
  }
  section + section {
    border-left: 1px solid #ecf0f1;
  }
  section h3 {
    margin: 8px 16px;
    font-size: 11px;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .tl-group {
    margin-bottom: 8px;
  }
  .tl-heading {
    margin: 6px 16px 2px;
    font-size: 12px;
    font-weight: 700;
    color: #2c3e50;
    border-bottom: 1px solid #ecf0f1;
    padding-bottom: 2px;
  }

  .empty {
    margin: 4px 16px;
    font-size: 13px;
    color: #95a5a6;
    font-style: italic;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 16px;
    font-size: 13px;
  }
  .row.code-row {
    color: #2c3e50;
    font-weight: 600;
  }
  .row.mat-row {
    padding-left: 32px;
    color: #5d6d7e;
    font-size: 12px;
  }
  .row .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .num {
    font-variant-numeric: tabular-nums;
    margin-left: 8px;
    color: #34495e;
  }
</style>
