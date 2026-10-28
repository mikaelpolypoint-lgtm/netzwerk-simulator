<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';
  import RoutingTable from './RoutingTable.svelte';
  import StateTables from './StateTables.svelte';

  /** Aktionsmodus für Switch, Router und Modem: was das Gerät gerade weiss. */
  let { device }: { device: Device } = $props();

  const deviceState = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id)));
  const now = $derived((simStore.tick, simStore.sim?.now ?? 0));
</script>

{#if device.type === 'switch'}
  <p class="muted">{t('switch.explain')}</p>
  <StateTables {device} macTable={deviceState?.macTable ?? []} {now} />
{:else if device.type === 'router'}
  <RoutingTable {device} />
  <StateTables {device} arp={deviceState?.arp ?? []} {now} />
  {#if deviceState?.console.length}
    <h3>{t('router.log')}</h3>
    <ol class="log">
      {#each deviceState.console.slice(-20) as line, i (i)}
        <li><span class="time">{(line.time / 1000).toFixed(3)}</span> {t(`console.${line.code}`, line.params)}</li>
      {/each}
    </ol>
  {/if}
{:else}
  <p class="muted">{t('modem.explain')}</p>
{/if}

<style>
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.75rem;
  }
  .time {
    color: var(--muted);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
</style>
