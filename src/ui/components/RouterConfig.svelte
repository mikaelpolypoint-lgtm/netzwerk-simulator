<script lang="ts">
  import { buildRoutes, parseMask, type Device, type StaticRoute } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { subnetSummary } from '../subnet';
  import RoutingTable from './RoutingTable.svelte';

  let { device }: { device: Device } = $props();

  // --- Interfaces ------------------------------------------------------------

  let drafts = $state<{ ip: string; mask: string }[]>([]);
  let ifaceError = $state<{ index: number; field?: string; text: string } | null>(null);

  $effect(() => {
    drafts = device.interfaces.map((i) => ({ ip: i.ip ?? '', mask: i.mask ?? '' }));
    ifaceError = null;
  });

  function applyInterface(event: SubmitEvent, index: number) {
    event.preventDefault();
    const draft = drafts[index];
    if (!draft) return;
    const failure = editor.setInterfaceAddress(device.id, index, draft.ip, draft.mask);
    ifaceError = failure ? { index, field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }

  const ifaceDirty = (index: number) => {
    const saved = device.interfaces[index];
    const draft = drafts[index];
    return !!draft && (draft.ip.trim() !== (saved?.ip ?? '') || draft.mask.trim() !== (saved?.mask ?? ''));
  };

  // --- DHCP-Relay ------------------------------------------------------------

  let relays = $state<string[]>([]);
  let relayError = $state<string | null>(null);

  $effect(() => {
    relays = device.interfaces.map((i) => i.dhcpRelay ?? '');
    relayError = null;
  });

  function applyRelay(event: SubmitEvent, index: number) {
    event.preventDefault();
    const failure = editor.setInterfaceRelay(device.id, index, relays[index] ?? '');
    relayError = failure ? t(`error.${failure.code}`, failure.params) : null;
  }

  // --- Statische Routen ------------------------------------------------------

  let route = $state({ network: '', mask: '', gateway: '', iface: '' });
  let routeError = $state<{ field?: string; text: string } | null>(null);
  const unusable = $derived(new Set(buildRoutes(device).unusable));

  function addRoute(event: SubmitEvent) {
    event.preventDefault();
    const input: StaticRoute = { network: route.network.trim(), mask: route.mask.trim() };
    if (route.gateway.trim()) input.gateway = route.gateway.trim();
    if (route.iface !== '') input.iface = Number(route.iface);
    const failure = editor.addStaticRoute(device.id, input);
    routeError = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
    if (!failure) route = { network: '', mask: '', gateway: '', iface: '' };
  }
</script>

<h3>{t('router.interfaces')}</h3>
{#each device.interfaces as iface, index (iface.index)}
  {@const draft = drafts[index]}
  {#if draft}
    <form class="iface" onsubmit={(e) => applyInterface(e, index)}>
      <span class="label">{interfaceLabel(device, index)}</span>
      <input
        aria-label={t('router.ifaceIp', { iface: interfaceLabel(device, index) })}
        placeholder={t('config.ip')}
        autocomplete="off"
        spellcheck="false"
        bind:value={draft.ip}
        aria-invalid={ifaceError?.index === index && ifaceError.field === 'ip'}
      />
      <input
        class="mask"
        aria-label={t('router.ifaceMask', { iface: interfaceLabel(device, index) })}
        placeholder="/24"
        autocomplete="off"
        spellcheck="false"
        bind:value={draft.mask}
        aria-invalid={ifaceError?.index === index && ifaceError.field === 'mask'}
      />
      <button type="submit" disabled={!ifaceDirty(index)} aria-label={t('config.apply')} title={t('config.apply')}>✓</button>
    </form>
    {#if ifaceError?.index === index}
      <p class="error" role="alert">{ifaceError.text}</p>
    {:else if iface.ip}
      <p class="muted small">{subnetSummary(iface.ip, iface.mask)}</p>
    {/if}
  {/if}
{/each}

<h3>{t('router.relay')}</h3>
<p class="muted small-text">{t('router.relayHint')}</p>
{#each device.interfaces as iface, index (iface.index)}
  <form class="relay" onsubmit={(e) => applyRelay(e, index)}>
    <span class="label">{interfaceLabel(device, index)}</span>
    <input
      aria-label={t('router.relayFor', { iface: interfaceLabel(device, index) })}
      placeholder={t('router.relayPlaceholder')}
      autocomplete="off"
      spellcheck="false"
      bind:value={relays[index]}
    />
    <button type="submit" disabled={(relays[index] ?? '').trim() === (iface.dhcpRelay ?? '')} aria-label={t('config.apply')} title={t('config.apply')}>✓</button>
  </form>
{/each}
{#if relayError}
  <p class="error" role="alert">{relayError}</p>
{/if}

<h3>{t('router.staticRoutes')}</h3>
{#if (device.routes ?? []).length === 0}
  <p class="muted small">{t('router.noRoutes')}</p>
{:else}
  <ul class="routes">
    {#each device.routes ?? [] as r, i (i)}
      <li class:unusable={unusable.has(i)}>
        <span class="mono">{r.network}/{parseMask(r.mask)}</span>
        <span>→ {r.gateway ?? interfaceLabel(device, r.iface ?? 0)}</span>
        <button class="small" onclick={() => editor.removeStaticRoute(device.id, i)} aria-label={t('router.removeRoute')}>
          ✕
        </button>
        {#if unusable.has(i)}
          <span class="hint">{t('router.routeUnusable')}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<form class="add-route" onsubmit={addRoute}>
  <div class="grid">
    <label>
      <span>{t('router.network')}</span>
      <input placeholder="10.1.0.0" autocomplete="off" spellcheck="false" bind:value={route.network} />
    </label>
    <label>
      <span>{t('config.mask')}</span>
      <input placeholder="/16" autocomplete="off" spellcheck="false" bind:value={route.mask} />
    </label>
    <label>
      <span>{t('router.via')}</span>
      <input placeholder="172.16.0.2" autocomplete="off" spellcheck="false" bind:value={route.gateway} />
    </label>
    <label>
      <span>{t('router.iface')}</span>
      <select bind:value={route.iface}>
        <option value="">{t('router.ifaceAuto')}</option>
        {#each device.interfaces as iface (iface.index)}
          <option value={String(iface.index)}>{interfaceLabel(device, iface.index)}</option>
        {/each}
      </select>
    </label>
  </div>
  {#if routeError}
    <p class="error" role="alert">{routeError.text}</p>
  {/if}
  <button type="submit" disabled={!route.network.trim() || !route.mask.trim()}>{t('router.addRoute')}</button>
</form>

<RoutingTable {device} />

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .relay {
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr) auto;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
  }
  .relay button {
    padding: 3px 8px;
  }
  .small-text {
    margin: 0 0 4px;
    font-size: 0.75rem;
  }
  .iface {
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr) 4.2rem auto;
    gap: 4px;
    align-items: center;
    margin-top: 6px;
  }
  .label {
    font-size: 0.8rem;
    font-weight: 600;
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  select {
    font-family: inherit;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .iface button {
    padding: 3px 8px;
  }
  .routes {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.8rem;
  }
  .routes li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
  }
  .routes li .small {
    margin-left: auto;
  }
  .routes li.unusable .mono {
    text-decoration: line-through;
  }
  .hint {
    width: 100%;
    font-size: 0.75rem;
    color: var(--danger);
  }
  .add-route {
    margin-top: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
    margin-bottom: 6px;
  }
  .grid label {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
  }
  .small {
    font-size: 0.75rem;
    padding: 2px 8px;
  }
  p.small {
    margin: 2px 0 0 2.9rem;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    margin: 4px 0;
    font-size: 0.8rem;
    color: var(--danger);
  }
</style>
