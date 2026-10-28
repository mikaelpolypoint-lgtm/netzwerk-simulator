<script lang="ts">
  import { getDevice } from '../../core';
  import { t } from '../../i18n';
  import { closeDesktop, desktop } from '../state/desktop.svelte';
  import { editor } from '../state/editor.svelte';
  import AddressView from './AddressView.svelte';
  import Browser from './Browser.svelte';
  import DhcpServerView from './DhcpServerView.svelte';
  import ServiceLog from './ServiceLog.svelte';
  import Terminal from './Terminal.svelte';

  /** Simulierter Desktop eines Endgeräts mit seinen Anwendungen. */
  const device = $derived(desktop.deviceId ? getDevice(editor.topology, desktop.deviceId) : undefined);
  const apps = $derived([
    'terminal',
    'browser',
    'network',
    ...(device?.dhcpServer ? ['dhcpServer'] : []),
    ...(device?.dnsServer ? ['dnsServer'] : []),
    ...(device?.webServer ? ['webServer'] : []),
  ]);
  const dnsSummary = $derived((device?.dnsServer?.records ?? []).map((r) => `${r.name}  ${r.type}  ${r.value}  (TTL ${r.ttl} s)`));

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeDesktop();
    }
  }
</script>

{#if device}
  <div class="desktop" role="dialog" aria-labelledby="desktop-title" tabindex="-1" {onkeydown}>
    <header>
      <h2 id="desktop-title">{t('desktop.title', { name: device.name })}</h2>
      <button class="close" onclick={closeDesktop} aria-label={t('desktop.close')}>✕</button>
    </header>
    <div class="apps" role="tablist">
      {#each apps as app (app)}
        <button role="tab" aria-selected={desktop.app === app} onclick={() => (desktop.app = app)}>
          {t(`desktop.app.${app}`)}
        </button>
      {/each}
    </div>
    <div class="content" role="tabpanel">
      {#if desktop.app === 'network'}
        <div class="padded"><AddressView {device} /></div>
      {:else if desktop.app === 'browser'}
        <Browser {device} />
      {:else if desktop.app === 'dhcpServer'}
        <DhcpServerView {device} />
      {:else if desktop.app === 'dnsServer'}
        <ServiceLog {device} prefix="dnsServer." summary={dnsSummary.length ? dnsSummary : [t('dnsServer.noRecords')]} />
      {:else if desktop.app === 'webServer'}
        <ServiceLog {device} prefix="http." summary={(device.webServer?.files ?? []).map((f) => f.path)} />
      {:else}
        <Terminal {device} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .desktop {
    position: absolute;
    top: 52px;
    right: 16px;
    width: min(620px, calc(100% - 32px));
    height: min(420px, calc(100% - 72px));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
    overflow: hidden;
    z-index: 5;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 6px 12px;
    background: var(--accent);
    color: var(--on-accent);
  }
  h2 {
    margin: 0;
    font-size: 0.9rem;
  }
  .close {
    padding: 2px 8px;
    color: inherit;
    background: transparent;
    border-color: transparent;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.15) !important;
  }
  .apps {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .apps button {
    font-size: 0.8rem;
    padding: 3px 10px;
  }
  .apps button[aria-selected='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  .content {
    flex: 1;
    min-height: 0;
  }
  .padded {
    padding: 12px;
  }
</style>
