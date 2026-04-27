<script lang="ts">
  import { areasStore, cellsStore } from '../stores/state';
  import { useStore } from '../useStore.svelte';
  import { currentPeriodStore, formatPeriod, getMaterialForAreaInPeriod } from '../stores/period';
  import { bulkDrawerOpen, toast } from '../stores/ui';

  const areas = useStore(areasStore);
  const cells = useStore(cellsStore);
  const currentPeriod = useStore(currentPeriodStore);

  // ── Stats ──
  const stats = $derived.by(() => {
    const cellsMap = cells.value;
    const areasMap = areas.value;

    // Tel zak-rijen (unieke zakRij/zakNum waarden)
    const rijen = new Set<string>();
    let zakPosTotal = 0;
    let zakPosEmpty = 0;
    let bunkerCount = 0;
    let lastChanged = 0;

    for (const c of cellsMap.values()) {
      if (c.cell_type === 'zak' && c.meta?.zakAnchor) {
        zakPosTotal++;
        const r = c.meta?.zakRij ?? c.meta?.zakNum;
        if (r !== undefined && r !== null) rijen.add(String(r));

        // Bepaal materiaal voor huidige periode
        const area = c.area_id != null ? areasMap.get(c.area_id) : null;
        const mat = getMaterialForAreaInPeriod(area, currentPeriod.value);
        if (!mat) zakPosEmpty++;
      }
    }

    for (const a of areasMap.values()) {
      if (a.area_type === 'bunker') bunkerCount++;
      const lf = Number(a.metadata?.lastFilled || a.updated_at || 0);
      if (lf > lastChanged) lastChanged = lf;
    }

    return {
      rijenCount: rijen.size,
      zakPosTotal,
      zakPosEmpty,
      bunkerCount,
      lastChanged,
    };
  });

  // ── Materiaal-overzicht ──
  // Voor elk uniek materiaal: count + percentage. Plus "leeg" als laatste entry.
  type MatRow = { name: string | null; count: number; pct: number; color: string };
  const matRows = $derived.by(() => {
    const cellsMap = cells.value;
    const areasMap = areas.value;
    const counts = new Map<string, number>(); // null → "(leeg)"
    let total = 0;

    // Zak-posities
    for (const c of cellsMap.values()) {
      if (c.cell_type === 'zak' && c.meta?.zakAnchor) {
        total++;
        const area = c.area_id != null ? areasMap.get(c.area_id) : null;
        const mat = getMaterialForAreaInPeriod(area, currentPeriod.value);
        const key = mat || '__empty__';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Bunkers tellen ook mee
    for (const a of areasMap.values()) {
      if (a.area_type !== 'bunker') continue;
      total++;
      const mat = getMaterialForAreaInPeriod(a, currentPeriod.value);
      const key = mat || '__empty__';
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    if (total === 0) return [] as MatRow[];

    const rows: MatRow[] = [];
    let emptyCount = 0;
    for (const [k, v] of counts) {
      if (k === '__empty__') { emptyCount = v; continue; }
      rows.push({
        name: k,
        count: v,
        pct: Math.round((v / total) * 100),
        color: hashColor(k),
      });
    }
    rows.sort((a, b) => b.count - a.count);
    if (emptyCount > 0) {
      rows.push({
        name: null,
        count: emptyCount,
        pct: Math.round((emptyCount / total) * 100),
        color: 'var(--text-tertiary)',
      });
    }
    return rows;
  });

  function hashColor(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 55%, 48%)`;
  }

  function formatLastChanged(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const day = d.getDate();
    const monthsNl = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const mn = monthsNl[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mn} · ${hh}:${mm}`;
  }

  function onMatBarClick(row: MatRow) {
    if (row.name) {
      toast(`${row.count} vlakken met ${row.name}`);
    } else {
      toast(`${row.count} lege vlakken`);
    }
  }

  function openBulk() {
    bulkDrawerOpen.set(true);
  }
</script>

<div class="strip">
  <div class="card">
    <div class="card-head">Status — {formatPeriod(currentPeriod.value)}</div>
    <div class="card-body">
      <div class="stat-grid tnum">
        <div class="stat">
          <span class="stat-num">{stats.rijenCount}</span>
          <span class="stat-lbl">zak-rijen</span>
        </div>
        <div class="stat">
          <span class="stat-num">{stats.zakPosTotal}</span>
          <span class="stat-lbl">zak-posities</span>
        </div>
        <div class="stat">
          <span class="stat-num warn">{stats.zakPosEmpty}</span>
          <span class="stat-lbl">leeg</span>
        </div>
        <div class="stat">
          <span class="stat-num">{stats.bunkerCount}</span>
          <span class="stat-lbl">bunkers</span>
        </div>
      </div>
      <div class="last-changed">
        <span class="lc-lbl">Laatste wijziging</span>
        <span class="lc-val tnum">{formatLastChanged(stats.lastChanged)}</span>
      </div>
    </div>
  </div>

  <div class="card mat-card">
    <div class="card-head">Materiaal-overzicht</div>
    <div class="card-body mat-body">
      {#if matRows.length === 0}
        <div class="mat-empty">Nog geen toewijzingen voor deze periode.</div>
      {:else}
        <div class="mat-list">
          {#each matRows as row, i (row.name ?? `__empty__${i}`)}
            <button class="mat-row" class:empty={!row.name} onclick={() => onMatBarClick(row)}>
              <span class="mat-bar-wrap">
                <span class="mat-bar" style:width={`${Math.max(2, row.pct)}%`} style:background={row.color}></span>
              </span>
              <span class="mat-name">{row.name || '— leeg'}</span>
              <span class="mat-count tnum">{row.count}</span>
              <span class="mat-pct tnum">{row.pct}%</span>
            </button>
          {/each}
        </div>
      {/if}
      <button class="bulk-btn" onclick={openBulk}>Bulk hertoewijzen →</button>
    </div>
  </div>
</div>

<style>
  .strip {
    flex-shrink: 0;
    height: 128px;
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--bg-app);
    border-top: 1px solid var(--border-subtle);
  }
  .card {
    flex: 1;
    min-width: 0;
    display: flex; flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    overflow: hidden;
  }
  .card-head {
    padding: 6px var(--space-3);
    font-size: var(--text-2xs);
    line-height: var(--text-2xs-line);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-sunken);
  }
  .card-body {
    padding: var(--space-2) var(--space-3);
    display: flex; flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    min-height: 0;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }
  .stat { display: flex; flex-direction: column; line-height: 1.1; }
  .stat-num {
    font-size: var(--text-md);
    font-weight: 800;
    color: var(--text-primary);
  }
  .stat-num.warn { color: var(--accent-warning); }
  .stat-lbl {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 1px;
  }
  .last-changed {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin-top: auto;
  }
  .lc-lbl {
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .lc-val {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .mat-body { flex-direction: row; gap: var(--space-2); }
  .mat-list {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    display: flex; flex-direction: column;
    gap: 2px;
    padding-right: 2px;
  }
  .mat-row {
    display: grid;
    grid-template-columns: 1fr 140px 50px 44px;
    align-items: center;
    gap: var(--space-2);
    background: transparent;
    border: 0;
    text-align: left;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background .12s;
  }
  .mat-row:hover { background: var(--bg-sunken); }
  .mat-row.empty .mat-name { color: var(--text-tertiary); font-style: italic; }
  .mat-bar-wrap {
    height: 12px;
    background: var(--bg-sunken);
    border-radius: 6px;
    overflow: hidden;
    min-width: 80px;
  }
  .mat-bar {
    display: block;
    height: 100%;
    border-radius: 6px;
    transition: width .2s;
  }
  .mat-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mat-count {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    text-align: right;
  }
  .mat-pct {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: right;
  }

  .mat-empty {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .bulk-btn {
    align-self: flex-end;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--mode-content);
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    height: 36px;
  }
  .bulk-btn:hover { background: var(--bg-surface); border-color: var(--mode-content); }

  @media (max-width: 720px) {
    .strip { height: auto; flex-direction: column; }
    .mat-body { flex-direction: column; }
  }
</style>
