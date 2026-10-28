<script lang="ts">
  import type { ArpEntry, Device, MacEntry } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';

  /** ARP- oder MAC-Tabelle aus dem Simulationszustand, mit Restlaufzeit der Einträge. */
  let {
    device,
    arp,
    macTable,
    now,
  }: { device: Device; arp?: ArpEntry[]; macTable?: MacEntry[]; now: number } = $props();

  const remaining = (expires: number) => t('actions.seconds', { s: Math.ceil((expires - now) / 1000) });
</script>

{#if arp}
  <h3>{t('actions.arp')}</h3>
  {#if arp.length === 0}
    <p class="muted">{t('actions.arpEmpty')}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">{t('actions.arpIp')}</th>
          <th scope="col">{t('actions.arpMac')}</th>
          {#if device.interfaces.length > 1}<th scope="col">{t('router.iface')}</th>{/if}
          <th scope="col">{t('actions.arpTtl')}</th>
        </tr>
      </thead>
      <tbody>
        {#each arp as entry (entry.ip)}
          <tr>
            <td class="mono">{entry.ip}</td>
            <td class="mono">{entry.mac}</td>
            {#if device.interfaces.length > 1}<td>{interfaceLabel(device, entry.iface)}</td>{/if}
            <td>{remaining(entry.expires)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

{#if macTable}
  <h3>{t('switch.macTable')}</h3>
  {#if macTable.length === 0}
    <p class="muted">{t('switch.macEmpty')}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">{t('switch.port')}</th>
          <th scope="col">{t('actions.arpMac')}</th>
          <th scope="col">{t('actions.arpTtl')}</th>
        </tr>
      </thead>
      <tbody>
        {#each macTable as entry (entry.mac)}
          <tr>
            <td>{interfaceLabel(device, entry.port)}</td>
            <td class="mono">{entry.mac}</td>
            <td>{remaining(entry.expires)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
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
  .muted {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
