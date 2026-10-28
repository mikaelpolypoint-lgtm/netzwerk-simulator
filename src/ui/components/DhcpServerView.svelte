<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';

  /** Desktop-Anwendung "DHCP-Server": vergebene Adressen und Protokoll des Dienstes. */
  let { device }: { device: Device } = $props();

  const deviceState = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id)));
  const leases = $derived(deviceState?.dhcpLeases ?? []);
  const log = $derived((deviceState?.console ?? []).filter((l) => l.code.startsWith('dhcpServer.')));
  const now = $derived((simStore.tick, simStore.sim?.now ?? 0));
  const config = $derived(device.dhcpServer);
</script>

<div class="view">
  {#if config}
    <p class="muted">
      {t('dhcpServer.range', { start: config.start, end: config.end, lease: config.leaseTime })}
    </p>
    <h3>{t('dhcpServer.leases')}</h3>
    {#if leases.length === 0}
      <p class="muted">{t('dhcpServer.noLeases')}</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">{t('actions.arpIp')}</th>
            <th scope="col">{t('actions.arpMac')}</th>
            <th scope="col">{t('actions.arpTtl')}</th>
          </tr>
        </thead>
        <tbody>
          {#each leases as lease (lease.mac)}
            <tr>
              <td class="mono">{lease.ip}</td>
              <td class="mono">{lease.mac}</td>
              <td>{t('actions.seconds', { s: Math.ceil((lease.expires - now) / 1000) })}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <h3>{t('dhcpServer.log')}</h3>
    <ol class="log">
      {#each log as line, i (i)}
        <li><span class="time">{(line.time / 1000).toFixed(3)}</span> {t(`console.${line.code}`, line.params)}</li>
      {:else}
        <li class="muted">{t('actions.consoleEmpty')}</li>
      {/each}
    </ol>
  {:else}
    <p class="muted">{t('dhcpServer.notConfigured')}</p>
  {/if}
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 0.85rem;
  }
  h3 {
    margin: 12px 0 6px;
    font-size: 0.85rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--muted);
    font-weight: normal;
  }
  .mono,
  .log {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.75rem;
  }
  .log li {
    padding: 2px 0;
  }
  .time {
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    margin: 0;
  }
</style>
