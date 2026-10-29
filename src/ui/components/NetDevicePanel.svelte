<script lang="ts">
  import { isRouterType, isSwitchType, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { simStore } from '../state/sim.svelte';
  import RoutingTable from './RoutingTable.svelte';
  import StateTables from './StateTables.svelte';

  /** Simulation für Switch, Router und Modem: was das Gerät gerade weiss. */
  let { device }: { device: Device } = $props();

  const deviceState = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id)));
  const now = $derived((simStore.tick, simStore.sim?.now ?? 0));
</script>

{#if deviceState?.storm}
  <p class="alert" role="alert">⚠ {t('storm.device', { rate: deviceState.storm.rate })}</p>
{/if}
{#if isSwitchType(device.type) || device.type === 'accesspoint'}
  <p class="muted">{t(device.type === 'accesspoint' ? 'ap.explain' : 'switch.explain')}</p>
  {#if deviceState?.stp}
    {@const stp = deviceState.stp}
    <h3>{t('switch.stp')}</h3>
    <dl class="facts">
      <dt>{t('switch.bridgeId')}</dt>
      <dd class="mono">{stp.bridgeId}</dd>
      <dt>{t('switch.rootId')}</dt>
      <dd class="mono">{stp.rootId}{stp.rootId === stp.bridgeId ? ` (${t('switch.isRoot')})` : ''}</dd>
      <dt>{t('switch.rootCost')}</dt>
      <dd>{stp.rootCost}</dd>
    </dl>
    <table>
      <thead>
        <tr>
          <th scope="col">{t('switch.port')}</th>
          <th scope="col">{t('switch.role')}</th>
          <th scope="col">{t('switch.state')}</th>
        </tr>
      </thead>
      <tbody>
        {#each stp.ports as port (port.port)}
          <tr class:blocked={port.state === 'blocking'}>
            <td>{interfaceLabel(device, port.port)}</td>
            <td>{t(`switch.role.${port.role}`)}</td>
            <td>{t(`switch.state.${port.state}`)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <StateTables {device} macTable={deviceState?.macTable ?? []} {now} />
  {#if device.type === 'l3switch'}
    <RoutingTable {device} live={deviceState?.routes} />
    <StateTables {device} arp={deviceState?.arp ?? []} {now} />
  {/if}
{:else if isRouterType(device.type)}
  {#if device.type === 'internet'}
    <p class="muted">{t('internet.explain')}</p>
  {/if}
  <RoutingTable {device} live={deviceState?.routes} />
  {#if deviceState?.ospf}
    {@const ospf = deviceState.ospf}
    <h3>{t('live.ospf', { id: ospf.routerId })}</h3>
    {#if ospf.neighbors.length === 0}
      <p class="muted">{t('live.ospfNone')}</p>
    {:else}
      <table>
        <thead><tr><th scope="col">{t('routing.routerId')}</th><th scope="col">IP</th><th scope="col">{t('routing.iface')}</th><th scope="col">{t('live.state')}</th></tr></thead>
        <tbody>
          {#each ospf.neighbors as n (n.routerId + n.iface)}
            <tr class:ok={n.state === 'full'}>
              <td class="mono">{n.routerId}</td>
              <td class="mono">{n.ip}</td>
              <td>{interfaceLabel(device, n.iface)}</td>
              <td>{n.state.toUpperCase()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p class="muted">{t('live.lsdb', { n: ospf.lsdb.length })}</p>
  {/if}
  {#if deviceState?.bgp}
    <h3>{t('live.bgp')}</h3>
    {#if deviceState.bgp.length === 0}
      <p class="muted">{t('routing.bgp.noNeighbors')}</p>
    {:else}
      <table>
        <thead><tr><th scope="col">{t('routing.bgp.neighborIp')}</th><th scope="col">AS</th><th scope="col">{t('live.state')}</th><th scope="col">{t('live.prefixes')}</th></tr></thead>
        <tbody>
          {#each deviceState.bgp as peer (peer.ip)}
            <tr class:ok={peer.state === 'established'}>
              <td class="mono">{peer.ip}</td>
              <td>{peer.remoteAs}</td>
              <td>{peer.state}</td>
              <td>{peer.received}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
  {#if deviceState?.ppp?.length}
    <h3>PPP</h3>
    <ul class="plain">
      {#each deviceState.ppp as link (link.port)}
        <li class:ok={link.phase === 'opened'}>{interfaceLabel(device, link.port)}: {t(`live.ppp.${link.phase}`)}</li>
      {/each}
    </ul>
  {/if}
  {#if device.staticNat?.length}
    <h3>{t('nat.static')}</h3>
    <ul class="plain mono">
      {#each device.staticNat as rule (rule.inside)}
        <li>{rule.inside} ⇄ {rule.outside}</li>
      {/each}
    </ul>
  {/if}
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
  {#if deviceState?.modem}
    {@const modem = deviceState.modem}
    <dl class="facts">
      <dt>{t('modem.standard')}</dt>
      <dd>{modem.standard}</dd>
      <dt>{t('live.state')}</dt>
      <dd class:ok={modem.phase === 'online'}>{t(`modem.phase.${modem.phase}`)}{modem.phase === 'connecting' ? ` (${modem.progress}/${modem.total})` : ''}</dd>
      {#if modem.phase === 'online'}
        <dt>{t('modem.rates')}</dt>
        <dd>↓ {modem.downstream} / ↑ {modem.upstream} Mbit/s</dd>
      {/if}
    </dl>
  {/if}
  {#if deviceState?.console.length}
    <ol class="log">
      {#each deviceState.console.slice(-12) as line, i (i)}
        <li><span class="time">{(line.time / 1000).toFixed(3)}</span> {t(`console.${line.code}`, line.params)}</li>
      {/each}
    </ol>
  {/if}
{/if}

<style>
  .alert {
    padding: 6px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--danger, #c0392b) 15%, transparent);
    color: var(--danger, #c0392b);
    font-size: 0.8rem;
  }
  .ok {
    color: var(--ok, #16a34a);
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.8rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0 0 6px;
    font-size: 0.75rem;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  tr.blocked td {
    color: var(--danger);
    font-weight: 600;
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
