<script lang="ts">
  import { parseMask, type Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';
  import { subnetSummary } from '../subnet';

  /** Wirksame Netzwerkeinstellungen eines Endgeräts, inklusive DHCP-Lease. */
  let { device }: { device: Device } = $props();

  const address = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id).address));
  const now = $derived((simStore.tick, simStore.sim?.now ?? 0));
  const prefix = $derived(address?.mask ? parseMask(address.mask) : null);
</script>

<dl class="facts">
  <dt>{t('address.mode')}</dt>
  <dd>{t(`address.mode.${address?.mode ?? (device.dhcp ? 'dhcp' : 'static')}`)}</dd>
  <dt>{t('config.ip')}</dt>
  <dd class="mono">{address?.ip ?? (address?.mode === 'dhcp' ? t('address.pending') : '–')}</dd>
  <dt>{t('config.mask')}</dt>
  <dd class="mono">{address?.mask ? `${address.mask} (/${prefix})` : '–'}</dd>
  <dt>{t('config.gateway')}</dt>
  <dd class="mono">{address?.gateway ?? '–'}</dd>
  <dt>{t('config.dns')}</dt>
  <dd class="mono">{address?.dns ?? '–'}</dd>
  {#if address?.mode === 'dhcp' && address.server && address.expires !== undefined}
    <dt>{t('address.server')}</dt>
    <dd class="mono">{address.server}</dd>
    <dt>{t('address.lease')}</dt>
    <dd>{t('actions.seconds', { s: Math.max(0, Math.ceil((address.expires - now) / 1000)) })}</dd>
  {/if}
</dl>
{#if address?.ip}
  <p class="muted">{subnetSummary(address.ip, address.mask)}</p>
{/if}

<style>
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0 0 6px;
    font-size: 0.8rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .muted {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
