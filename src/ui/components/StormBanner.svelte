<script lang="ts">
  import { t } from '../../i18n';
  import { dialogs } from '../state/dialogs.svelte';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';

  /** Warnung, solange Switches einen Broadcast-Sturm erleben (Schleife ohne Spanning Tree). */
  const storming = $derived((simStore.tick, simStore.sim?.stormingDevices() ?? []));
  const names = $derived(storming.map((id) => editor.topology.devices.find((d) => d.id === id)?.name ?? id));
</script>

{#if storming.length}
  <div class="storm" role="alert">
    <strong>⚠ {t('storm.title')}</strong>
    <span>{t('storm.text', { names: names.join(', ') })}</span>
    <button onclick={() => dialogs.showHelp('stp')}>{t('storm.help')}</button>
  </div>
{/if}

<style>
  .storm {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 6px 12px;
    background: #fee2e2;
    color: #7f1d1d;
    border-bottom: 1px solid #fca5a5;
    font-size: 0.85rem;
    animation: pulse 1.2s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    from {
      background: #fee2e2;
    }
    to {
      background: #fecaca;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .storm {
      animation: none;
    }
  }
  button {
    font-size: 0.8rem;
  }
</style>
