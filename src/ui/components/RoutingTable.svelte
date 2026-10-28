<script lang="ts">
  import { buildRoutes, formatIp, maskToText, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';

  let { device }: { device: Device } = $props();

  const table = $derived(buildRoutes(device));
</script>

<h3>{t('routing.title')}</h3>
{#if table.routes.length === 0}
  <p class="muted">{t('routing.empty')}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th scope="col">{t('routing.destination')}</th>
        <th scope="col">{t('routing.gateway')}</th>
        <th scope="col">{t('routing.iface')}</th>
      </tr>
    </thead>
    <tbody>
      {#each table.routes as route, i (i)}
        <tr title={t(`routing.kind.${route.kind}`)}>
          <td class="mono">
            {formatIp(route.network)}/{route.prefix}
            <span class="mask">{maskToText(route.prefix)}</span>
          </td>
          <td class="mono">{route.via === null ? t('routing.direct') : formatIp(route.via)}</td>
          <td>{interfaceLabel(device, route.iface)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
{#if table.unusable.length > 0}
  <p class="warning" role="note">⚠ {t('routing.unusable', { n: table.unusable.length })}</p>
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
