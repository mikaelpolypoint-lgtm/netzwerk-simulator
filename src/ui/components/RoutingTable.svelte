<script lang="ts">
  import { buildRoutes, formatIp, maskToText, type Device, type Route } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';

  /** `live`: wirksame Tabelle aus der Simulation, inklusive gelernter Routen (OSPF, RIP, BGP). */
  let { device, live }: { device: Device; live?: readonly Route[] } = $props();

  const configured = $derived(buildRoutes(device));
  const routes = $derived(live ?? configured.routes);
  const CODES: Record<Route['kind'], string> = { connected: 'C', static: 'S', default: 'S*', ospf: 'O', rip: 'R', bgp: 'B' };
  const dynamic = $derived(routes.some((r) => r.kind === 'ospf' || r.kind === 'rip' || r.kind === 'bgp'));
</script>

<h3>{t('routing.title')}</h3>
{#if routes.length === 0}
  <p class="muted">{t('routing.empty')}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th scope="col" title={t('routing.codeHint')}>{t('routing.code')}</th>
        <th scope="col">{t('routing.destination')}</th>
        <th scope="col">{t('routing.gateway')}</th>
        <th scope="col">{t('routing.iface')}</th>
        {#if dynamic}<th scope="col" title={t('routing.metricHint')}>[AD/{t('routing.metric')}]</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each routes as route, i (i)}
        <tr title={t(`routing.kind.${route.kind}`)}>
          <td class="mono code code-{route.kind}">{CODES[route.kind]}</td>
          <td class="mono">
            {formatIp(route.network)}/{route.prefix}
            <span class="mask">{maskToText(route.prefix)}</span>
          </td>
          <td class="mono">{route.via === null ? t('routing.direct') : formatIp(route.via)}</td>
          <td>{interfaceLabel(device, route.iface)}</td>
          {#if dynamic}<td class="mono">{route.distance !== undefined ? `[${route.distance}/${route.metric ?? 0}]` : ''}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
{#if configured.unusable.length > 0}
  <p class="warning" role="note">⚠ {t('routing.unusable', { n: configured.unusable.length })}</p>
{/if}

<style>
  .code {
    font-weight: 700;
  }
  .code-ospf {
    color: #16a085;
  }
  .code-rip {
    color: #2e86c1;
  }
  .code-bgp {
    color: #8e44ad;
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
    vertical-align: top;
  }
  th {
    color: var(--muted);
    font-weight: normal;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .mask {
    display: block;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .warning {
    margin: 6px 0 0;
    padding: 6px 8px;
    font-size: 0.8rem;
    border-radius: 6px;
    background: var(--warning-soft);
  }
</style>
