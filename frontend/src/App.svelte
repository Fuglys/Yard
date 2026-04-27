<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './lib/components/Header.svelte';
  import YardCanvas from './lib/components/YardCanvas.svelte';
  import EditPanel from './lib/components/edit-panel/EditPanelV2.svelte';
  import AreaInspector from './lib/components/AreaInspector.svelte';
  import LoginModal from './lib/components/LoginModal.svelte';
  import Toast from './lib/components/Toast.svelte';
  import PlaceAssignChip from './lib/components/PlaceAssignChip.svelte';
  import BulkReassignDrawer from './lib/components/BulkReassignDrawer.svelte';

  import { startSync, schedulePush } from './lib/sync/engine';
  import { loadMaterials } from './lib/stores/materials';
  import { authStore, modeStore, editPanelOpen } from './lib/stores/ui';
  import { cellsStore, deleteCells, areasStore, upsertArea, upsertCells, nextTempId } from './lib/stores/state';
  import { useStore } from './lib/useStore.svelte';

  const mode = useStore(modeStore);
  const auth = useStore(authStore);
  const canEditApp = $derived(auth.value?.role === 'admin' || auth.value?.role === 'supervisor');

  // Migratie: bestaande container/afval cellen zonder area_id krijgen
  // alsnog een 'Container' / 'Afval' area zodat hun naam in het midden van
  // het cluster wordt getoond. Eénmalig: doet niets als alle cellen al area_id hebben.
  async function migrateContainerAfvalAreas() {
    const cellsMap = cellsStore.get();
    const areasMap = areasStore.get();

    // Verzamel area-loze container/afval cellen, gegroepeerd per type
    const orphans: Record<'container' | 'afval', Array<{ col: number; row: number }>> = {
      container: [],
      afval: [],
    };
    for (const c of cellsMap.values()) {
      if ((c.cell_type === 'container' || c.cell_type === 'afval') && c.area_id == null) {
        orphans[c.cell_type as 'container' | 'afval'].push({ col: c.col, row: c.row });
      }
    }
    const total = orphans.container.length + orphans.afval.length;
    if (total === 0) return;

    // Find connected components per type (4-connected)
    function findComponents(cells: Array<{ col: number; row: number }>): Array<Array<{ col: number; row: number }>> {
      const cellSet = new Set(cells.map((c) => `${c.col},${c.row}`));
      const visited = new Set<string>();
      const components: Array<Array<{ col: number; row: number }>> = [];
      for (const c of cells) {
        const k = `${c.col},${c.row}`;
        if (visited.has(k)) continue;
        const comp: Array<{ col: number; row: number }> = [];
        const stack = [c];
        while (stack.length) {
          const cur = stack.pop()!;
          const ck = `${cur.col},${cur.row}`;
          if (visited.has(ck)) continue;
          visited.add(ck);
          comp.push(cur);
          for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]] as Array<[number,number]>) {
            const nk = `${cur.col + dc},${cur.row + dr}`;
            if (cellSet.has(nk) && !visited.has(nk)) {
              stack.push({ col: cur.col + dc, row: cur.row + dr });
            }
          }
        }
        components.push(comp);
      }
      return components;
    }

    let createdAreas = 0;
    let updatedCells = 0;

    for (const cellType of ['container', 'afval'] as const) {
      const list = orphans[cellType];
      if (!list.length) continue;
      const components = findComponents(list);
      const label = cellType === 'container' ? 'Container' : 'Afval';
      const color = cellType === 'container' ? '#7f8c8d' : '#95a5a6';

      for (const comp of components) {
        // Check of er al een aangrenzende area met dezelfde naam bestaat — zo ja, hergebruik
        let target: any = null;
        for (const c of comp) {
          for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]] as Array<[number,number]>) {
            const nb = cellsMap.get(`${c.col + dc},${c.row + dr}`);
            if (nb && nb.area_id != null) {
              const a = areasMap.get(nb.area_id);
              if (a && a.area_type === cellType && (a.name || '') === label) {
                target = a;
                break;
              }
            }
          }
          if (target) break;
        }

        if (!target) {
          target = {
            id: nextTempId(),
            name: label,
            area_type: cellType,
            color,
            updated_at: Date.now(),
          };
          await upsertArea(target);
          createdAreas++;
        }

        const ts = Date.now();
        const upserts = comp.map((c) => {
          const existing = cellsMap.get(`${c.col},${c.row}`);
          return {
            col: c.col, row: c.row,
            cell_type: cellType,
            area_id: target.id,
            label: '',
            meta: existing?.meta || {},
            updated_at: ts,
          };
        });
        await upsertCells(upserts);
        updatedCells += upserts.length;
      }
    }

    if (createdAreas + updatedCells > 0) {
      console.log(`[migration] container/afval: ${createdAreas} areas aangemaakt, ${updatedCells} cellen bijgewerkt`);
      schedulePush();
    }
  }
  if (typeof window !== 'undefined') (window as any).__yardMigrateContainerAfval = migrateContainerAfvalAreas;

  // Wis alle losse zak-num cellen (was auto-gegenereerd of orphaned)
  async function cleanupOrphanZakNums() {
    const orphans: Array<{ col: number; row: number }> = [];
    for (const c of cellsStore.get().values()) {
      // Pak alle auto-gegenereerde zak-num én alle losse zak-num zonder geldige zak ernaast
      if (c.cell_type !== 'zak-num') continue;
      if (c.meta?.autoFromZak) {
        orphans.push({ col: c.col, row: c.row });
      }
    }
    if (orphans.length) {
      console.log(`[migration] cleaning up ${orphans.length} orphan zak-num cells`);
      await deleteCells(orphans);
      schedulePush();
    }
  }
  // Maak globaal beschikbaar zodat je vanuit DevTools handmatig kan opruimen
  if (typeof window !== 'undefined') (window as any).__yardCleanupOrphanNums = cleanupOrphanZakNums;
  import { history } from './lib/stores/history'; // Side-effect: registreert hooks in state.ts
  // Maak globaal beschikbaar voor debug in DevTools
  if (typeof window !== 'undefined') (window as any).__yardHistory = history;

  // Update-detectie: zodra nieuwe service worker takes over, toon banner met reload-knop
  let updateAvailable = $state(false);
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    let firstControllerChange = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (firstControllerChange) { firstControllerChange = false; return; }
      updateAvailable = true;
    });
  }
  function reloadForUpdate() {
    location.reload();
  }

  let canvas: { zoomIn: () => void; zoomOut: () => void; fit: () => void };
  let loginOpen = $state(false);

  onMount(() => {
    // Restore auth uit localStorage
    const stored = localStorage.getItem('yardAuth');
    if (stored) {
      try { authStore.set(JSON.parse(stored)); } catch {}
    }
    authStore.subscribe((u) => {
      if (u) localStorage.setItem('yardAuth', JSON.stringify(u));
      else {
        localStorage.removeItem('yardAuth');
        // Forceer terug naar overzicht zodra je uitlogt
        if (modeStore.get() !== 'view') modeStore.set('view');
        editPanelOpen.set(false);
      }
    });

    startSync().then(() => {
      // Wacht tot data binnen is dan opruimen + migreren
      setTimeout(() => {
        cleanupOrphanZakNums();
        migrateContainerAfvalAreas();
      }, 1500);
    });
    loadMaterials();
  });

  function logout() {
    authStore.set(null);
    modeStore.set('view');
    editPanelOpen.set(false);
  }
</script>

<Header
  onZoomIn={() => canvas?.zoomIn()}
  onZoomOut={() => canvas?.zoomOut()}
  onFit={() => canvas?.fit()}
  onLoginClick={() => (loginOpen = true)}
  onLogout={logout}
/>

<main>
  <div class="canvas-area">
    <YardCanvas bind:this={canvas} />
  </div>
  <EditPanel />
</main>

<AreaInspector />
<PlaceAssignChip />
<BulkReassignDrawer />
<LoginModal bind:open={loginOpen} />
<Toast />

{#if updateAvailable}
  <div class="update-banner">
    <span>🎉 Nieuwe versie beschikbaar</span>
    <button onclick={reloadForUpdate}>🔄 Vernieuwen</button>
  </div>
{/if}

<style>
  main {
    flex: 1;
    display: flex;
    position: relative;
    overflow: hidden;
    min-height: 0;
  }
  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  :global(main > .canvas) { flex: 1; }

  .update-banner {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #27ae60, #1e8449);
    color: #fff;
    padding: 12px 20px;
    border-radius: 14px;
    font-weight: 700;
    font-size: 14px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.25);
    z-index: 5000;
    display: flex;
    align-items: center;
    gap: 14px;
    animation: scaleIn .25s cubic-bezier(.2,.9,.3,1.1);
  }
  .update-banner button {
    background: #fff;
    color: #1e8449;
    border: 0;
    padding: 8px 16px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
  }
</style>
