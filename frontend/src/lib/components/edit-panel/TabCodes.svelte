<script lang="ts">
  import { useStore } from '../../useStore.svelte';
  import { zakCodesStore, resetZakCodesToDefault, toast, type ZakCodeConfig } from '../../stores/ui';
  import SectionCard from './SectionCard.svelte';

  const codes = useStore(zakCodesStore);

  let newCode = $state('');
  let newLink = $state<'tl1' | 'tl2' | null>(null);

  function setLink(idx: number, link: 'tl1' | 'tl2' | null) {
    const list = codes.value.map((c, i) => i === idx ? { ...c, tlLink: link } : c);
    zakCodesStore.set(list);
  }

  function removeCode(idx: number) {
    const c = codes.value[idx];
    if (!c) return;
    if (!confirm(`Code "${c.code}" verwijderen uit het zak-popover?`)) return;
    const list = codes.value.filter((_, i) => i !== idx);
    zakCodesStore.set(list);
    toast(`${c.code} verwijderd`);
  }

  function addCode() {
    const trimmed = newCode.trim();
    if (!trimmed) return;
    if (codes.value.some((c) => c.code.toLowerCase() === trimmed.toLowerCase())) {
      toast(`"${trimmed}" bestaat al`);
      return;
    }
    if (trimmed.length > 20) {
      toast('Maximaal 20 tekens');
      return;
    }
    const newEntry: ZakCodeConfig = { code: trimmed, tlLink: newLink };
    zakCodesStore.set([...codes.value, newEntry]);
    newCode = '';
    newLink = null;
    toast(`${trimmed} toegevoegd`);
  }

  function resetAll() {
    if (!confirm('Alle eigen wijzigingen ongedaan maken en terug naar de standaard-lijst?')) return;
    resetZakCodesToDefault();
    toast('Codes teruggezet naar standaard');
  }

  // Groepeer voor weergave in dezelfde volgorde als het popover
  const tl1List = $derived(codes.value.map((c, i) => ({ ...c, idx: i })).filter((c) => c.tlLink === 'tl1'));
  const tl2List = $derived(codes.value.map((c, i) => ({ ...c, idx: i })).filter((c) => c.tlLink === 'tl2'));
  const losList = $derived(codes.value.map((c, i) => ({ ...c, idx: i })).filter((c) => c.tlLink === null));
</script>

<SectionCard title="Zak-codes beheren">
  <p class="hint">
    Welke codes verschijnen in het zak-popover wanneer je in Overzicht-modus
    op een zak klikt. Per code kies je of de TL1- of TL2-materiaalnaam erbij
    komt te staan, of geen.
  </p>

  {#snippet codeList(label: string, list: Array<ZakCodeConfig & { idx: number }>)}
    {#if list.length > 0}
      <div class="cat">
        <div class="cat-label">{label}</div>
        {#each list as item (item.code)}
          <div class="row">
            <span class="row-code">{item.code}</span>
            <div class="link-grp" role="radiogroup">
              <button
                class="link-btn"
                class:active={item.tlLink === 'tl1'}
                onclick={() => setLink(item.idx, 'tl1')}
                title="TL1-materiaalnaam erbij tonen"
              >TL1</button>
              <button
                class="link-btn"
                class:active={item.tlLink === 'tl2'}
                onclick={() => setLink(item.idx, 'tl2')}
                title="TL2-materiaalnaam erbij tonen"
              >TL2</button>
              <button
                class="link-btn"
                class:active={item.tlLink === null}
                onclick={() => setLink(item.idx, null)}
                title="Geen prefix"
              >—</button>
            </div>
            <button class="del-btn" onclick={() => removeCode(item.idx)} title="Code verwijderen">🗑</button>
          </div>
        {/each}
      </div>
    {/if}
  {/snippet}

  {@render codeList('TL1-codes', tl1List)}
  {@render codeList('TL2-codes', tl2List)}
  {@render codeList('Los (geen TL)', losList)}
</SectionCard>

<SectionCard title="Code toevoegen">
  <div class="add-form">
    <input
      class="add-input"
      type="text"
      bind:value={newCode}
      placeholder="Bijv. S29B, T29A, Pellets…"
      maxlength="20"
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCode(); } }}
    />
    <div class="add-link">
      <span class="add-label">Materiaal-prefix:</span>
      <div class="link-grp">
        <button class="link-btn" class:active={newLink === 'tl1'} onclick={() => (newLink = 'tl1')}>TL1</button>
        <button class="link-btn" class:active={newLink === 'tl2'} onclick={() => (newLink = 'tl2')}>TL2</button>
        <button class="link-btn" class:active={newLink === null} onclick={() => (newLink = null)}>—</button>
      </div>
    </div>
    <button class="add-btn" onclick={addCode} disabled={!newCode.trim()}>+ Toevoegen</button>
  </div>
</SectionCard>

<SectionCard title="Standaard">
  <button class="reset-btn" onclick={resetAll}>↶ Terug naar standaard-lijst</button>
  <p class="hint">
    Zet de lijst terug naar de standaard 12 codes (S01-S17, T01-T17, S29, S29A,
    Granulaat Mix/Naturel). Eigen toegevoegde codes worden verwijderd.
  </p>
</SectionCard>

<style>
  .hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0 0 8px 0;
    line-height: var(--text-xs-line);
  }

  .cat { margin-bottom: 10px; }
  .cat-label {
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    margin: 6px 0 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    margin-bottom: 3px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }
  .row-code {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .link-grp { display: flex; gap: 2px; }
  .link-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all .12s;
  }
  .link-btn:hover { background: var(--bg-sunken); }
  .link-btn.active {
    background: var(--accent-primary);
    color: #fff;
    border-color: var(--accent-primary);
  }

  .del-btn {
    background: transparent;
    border: 0;
    padding: 4px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
  }
  .del-btn:hover { background: rgba(231,76,60,0.12); color: #e74c3c; }

  .add-form { display: flex; flex-direction: column; gap: 8px; }
  .add-input {
    height: 38px;
    padding: 0 var(--space-3);
    border: 1.5px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-sunken);
    font-size: var(--text-sm);
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
  }
  .add-input:focus { border-color: var(--accent-primary); background: var(--bg-surface); }
  .add-link {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--text-xs);
  }
  .add-label { color: var(--text-secondary); font-weight: 600; }
  .add-btn {
    height: 40px;
    background: var(--mode-layout);
    color: #fff;
    border: 0;
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .add-btn:disabled { opacity: .4; cursor: not-allowed; }
  .add-btn:hover:not(:disabled) { filter: brightness(1.06); }

  .reset-btn {
    width: 100%;
    height: 38px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    margin-bottom: 6px;
  }
  .reset-btn:hover { background: var(--bg-surface); color: var(--text-primary); }
</style>
