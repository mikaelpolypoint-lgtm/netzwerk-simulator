<script lang="ts">
  import { isRouterType, type Device } from '../../core';
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
{:else if isRouterType(device.type)}
  {#if device.type === 'internet'}
    <p class="muted">{t('internet.explain')}</p>
  {/if}
  <RoutingTable {device} />
  {#if device.type === 'router' && device.interfaces.some((i) => i.nat)}
    <h3>{t('nat.table')}</h3>
    {#if (deviceState?.nat ?? []).length === 0}
      <p class="muted">{t('nat.empty')}</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">{t('nat.protocol')}</th>
            <th scope="col">{t('nat.inside')}</th>
            <th scope="col">{t('nat.outside')}</th>
          </tr>
        </thead>
        <tbody>
          {#each deviceState?.nat ?? [] as entry (`${entry.protocol}:${entry.outsidePort}`)}
            <tr>
              <td>{entry.protocol.toUpperCase()}{entry.forwarded ? ' ⇄' : ''}</td>
              <td class="mono">{entry.inside}:{entry.insidePort}</td>
              <td class="mono">{entry.outside}:{entry.outsidePort}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }
  th,
  td {
    text-align: left;
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--muted);
    font-weight: normal;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
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
