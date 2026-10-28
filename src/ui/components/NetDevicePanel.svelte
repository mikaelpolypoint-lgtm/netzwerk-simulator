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
{:else}
  <p class="muted">{t('modem.explain')}</p>
{/if}

<style>
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
