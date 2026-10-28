<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import DhcpServerForm from './DhcpServerForm.svelte';
  import DnsServerForm from './DnsServerForm.svelte';
  import WebServerForm from './WebServerForm.svelte';

  /** Entwurfsmodus, Rechner: Server-Dienste, jeweils aufklappbar. */
  let { device }: { device: Device } = $props();

  const services = $derived([
    { key: 'dhcp', active: !!device.dhcpServer },
    { key: 'dns', active: !!device.dnsServer },
    { key: 'web', active: !!device.webServer },
  ]);
</script>

<h3>{t('services.title')}</h3>
{#each services as service (service.key)}
  <details open={service.active}>
    <summary>
      {t(`services.${service.key}`)}
      <span class="badge" class:on={service.active}>{t(service.active ? 'services.on' : 'services.off')}</span>
    </summary>
    <div class="body">
      {#if service.key === 'dhcp'}
        <DhcpServerForm {device} />
      {:else if service.key === 'dns'}
        <DnsServerForm {device} />
      {:else}
        <WebServerForm {device} />
      {/if}
    </div>
  </details>
{/each}

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  details {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 6px;
  }
  summary {
    cursor: pointer;
    padding: 5px 8px;
    font-size: 0.85rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .body {
    padding: 4px 8px 8px;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: normal;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .badge.on {
    background: var(--distribution-soft);
    color: var(--distribution);
  }
</style>
