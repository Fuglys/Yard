<script lang="ts">
  import { authStore, toast } from '../stores/ui';
  import { apiUrl } from '../api';

  let { open = $bindable(false) } = $props();

  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit() {
    if (busy) return;
    error = '';
    busy = true;
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        error = data.error || 'Inloggen mislukt';
      } else {
        authStore.set({ username: data.username, role: data.role });
        toast(`Welkom, ${data.username}`);
        open = false;
        username = ''; password = '';
      }
    } catch (e: any) {
      error = 'Verbindingsfout: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function close() { if (!busy) open = false; }
</script>

{#if open}
  <div class="overlay" role="presentation" onclick={close}>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <h2>Inloggen</h2>
        <button class="x" onclick={close} aria-label="Sluiten">×</button>
      </div>
      <p class="sub">Admin / supervisor account uit dagstart</p>
      <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text" placeholder="Gebruikersnaam"
          bind:value={username} autocomplete="username"
          autofocus required disabled={busy}
        />
        <input
          type="password" placeholder="Wachtwoord"
          bind:value={password} autocomplete="current-password"
          required disabled={busy}
        />
        {#if error}<div class="err">{error}</div>{/if}
        <button type="submit" class="btn primary submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, 0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 20px;
    backdrop-filter: blur(4px);
    animation: fadeIn .18s;
  }
  .modal {
    background: #fff; border-radius: 16px; width: 100%; max-width: 360px;
    padding: 22px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.18);
    animation: scaleIn .18s cubic-bezier(.2,.9,.3,1.1);
  }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .head h2 { font-size: 17px; color: #1a1a2e; }
  .x { background: transparent; border: 0; font-size: 24px; color: #94a3b8; padding: 0 4px; line-height: 1; }
  .sub { font-size: 12px; color: #94a3b8; margin-bottom: 16px; }
  form { display: flex; flex-direction: column; gap: 10px; }
  input {
    padding: 11px 13px; border: 1px solid #e2e6ea; border-radius: 9px;
    background: #f7f8fa; font-size: 14px; outline: none;
    transition: border-color .12s, background .12s;
  }
  input:focus { border-color: #2e86c1; background: #fff; box-shadow: 0 0 0 3px rgba(46,134,193,0.15); }
  .err {
    background: #fdecea; color: #c0392b; padding: 8px 12px; border-radius: 8px;
    font-size: 12px; font-weight: 600; border: 1px solid #f5c6cb;
  }
  .submit { padding: 11px; font-size: 14px; }
</style>
