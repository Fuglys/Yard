<script lang="ts">
  import { toastStore } from '../stores/ui';
  import { useStore } from '../useStore.svelte';
  const toast = useStore(toastStore);
</script>

{#if toast.value}
  <div class="toast">{toast.value.message}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #2c3e50;
    color: #fff;
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    z-index: 5000;
    animation: scaleIn .15s ease-out;
    pointer-events: none;
  }
</style>
