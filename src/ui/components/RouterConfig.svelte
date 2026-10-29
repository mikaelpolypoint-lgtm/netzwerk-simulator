<script lang="ts">
  import { buildRoutes, cableAt, logicalInterfaces, parseMask, type Device, type SerialEncapsulation, type StaticRoute } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { dialogs } from '../state/dialogs.svelte';
  import { editor } from '../state/editor.svelte';
  import { subnetSummary } from '../subnet';
  import { ui } from '../state/ui.svelte';
  import Icon from './Icon.svelte';
  import RoutingProtocols from './RoutingProtocols.svelte';
  import RoutingTable from './RoutingTable.svelte';
  import ScopeBadge from './ScopeBadge.svelte';
  import SubinterfaceConfig from './SubinterfaceConfig.svelte';

  /** routesOnly: nur statische Routen (Layer-3-Switch, dessen Adressen auf den SVIs liegen). */
  let { device, routesOnly = false }: { device: Device; routesOnly?: boolean } = $props();

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

  /** IP-Rechner öffnen; «Übernehmen» setzt die erste nutzbare Adresse (typisch für Router). */
  function calc(index: number) {
    const draft = drafts[index];
    dialogs.ipCalculator({
      ip: draft?.ip || undefined,
      mask: draft?.mask || undefined,
      apply: (v) => {
        const failure = editor.setInterfaceAddress(device.id, index, v.gateway, v.mask);
        ifaceError = failure ? { index, field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
      },
    });
  }

  const connected = (index: number) => !!cableAt(editor.topology, { device: device.id, iface: index });

  // --- Statisches NAT -----------------------------------------------------------

  let staticDraft = $state({ inside: '', outside: '' });
  let staticError = $state<string | null>(null);

  function addStatic(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.addStaticNat(device.id, staticDraft);
    staticError = failure ? t(`error.${failure.code}`, failure.params) : null;
    if (!failure) staticDraft = { inside: '', outside: '' };
  }

  // --- CGNAT (Provider) ---------------------------------------------------------

  let cgnatAddress = $state('');
  let cgnatError = $state<string | null>(null);
  $effect(() => {
    cgnatAddress = device.cgnatAddress ?? '';
  });

  function applyCgnat(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.setCgnatAddress(device.id, cgnatAddress);
    cgnatError = failure ? t(`error.${failure.code}`, failure.params) : null;
  }

  const ifaceDirty = (index: number) => {
    const saved = device.interfaces[index];
    const draft = drafts[index];
    return !!draft && (draft.ip.trim() !== (saved?.ip ?? '') || draft.mask.trim() !== (saved?.mask ?? ''));
  };

  // --- NAT-Portweiterleitungen -------------------------------------------------

  let forwardDraft = $state({ protocol: 'tcp' as 'tcp' | 'udp', port: '80', to: '', toPort: '80' });
  let forwardError = $state<string | null>(null);

  function addForward(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.addPortForward(device.id, {
      protocol: forwardDraft.protocol,
      port: Number(forwardDraft.port),
      to: forwardDraft.to,
      toPort: Number(forwardDraft.toPort || forwardDraft.port),
    });
    forwardError = failure ? t(`error.${failure.code}`, failure.params) : null;
    if (!failure) forwardDraft = { ...forwardDraft, to: '' };
  }

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

{#if !routesOnly}
<h3>{t('router.interfaces')}</h3>
{#each device.interfaces as iface, index (iface.index)}
  {@const draft = drafts[index]}
  {#if draft}
    {#if device.type === 'router' && ui.has('medium.serial') && !iface.sfpSlot}
      <div class="kind">
        <select
          value={iface.serial ? 'serial' : 'ethernet'}
          disabled={!editor.editable || connected(index)}
          title={connected(index) ? t('router.kindConnected') : t('router.kindHint')}
          aria-label={t('router.kindOf', { iface: interfaceLabel(device, index) })}
          onchange={(e) => editor.setPortSerial(device.id, index, e.currentTarget.value === 'serial')}
        >
          <option value="ethernet">Ethernet</option>
          <option value="serial">{t('router.serial')}</option>
        </select>
        {#if iface.serial}
          <select
            value={iface.encapsulation ?? 'hdlc'}
            disabled={!editor.editable}
            aria-label={t('router.encapsulation')}
            title={t('router.encapsulationHint')}
            onchange={(e) => editor.setEncapsulation(device.id, index, e.currentTarget.value as SerialEncapsulation)}
          >
            <option value="hdlc">HDLC</option>
            <option value="ppp">PPP</option>
          </select>
        {/if}
      </div>
    {/if}
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
      {#if ui.has('tool.ipCalculator')}
        <button type="button" class="calc" onclick={() => calc(index)} aria-label={t('menu.tool.ipcalc')} title={t('ipcalc.openHint')}><Icon name="calc" size={15} /></button>
      {/if}
    </form>
    {#if ifaceError?.index === index}
      <p class="error" role="alert">{ifaceError.text}</p>
    {:else if iface.ip}
      <p class="muted small">{#if ui.has('tool.addressBadges')}<ScopeBadge ip={iface.ip} /> {/if}{subnetSummary(iface.ip, iface.mask)}</p>
    {/if}
  {/if}
{/each}

{/if}

{#if device.type === 'router' && ui.has('net.subinterfaces')}
  <SubinterfaceConfig {device} />
{/if}

{#if device.type === 'internet' && ui.has('net.cgnat')}
  <details class="section" open={!!device.cgnatAddress} data-help="cgnat">
    <summary>{t('cgnat.title')}</summary>
    <p class="muted small-text">{t('cgnat.hint')}</p>
    <form class="relay" onsubmit={applyCgnat}>
      <span class="label">{t('cgnat.address')}</span>
      <input bind:value={cgnatAddress} placeholder="192.0.2.1" disabled={!editor.editable} aria-label={t('cgnat.address')} />
      <button type="submit" disabled={!editor.editable || cgnatAddress.trim() === (device.cgnatAddress ?? '')}>✓</button>
    </form>
    {#if cgnatError}<p class="error" role="alert">{cgnatError}</p>{/if}
    {#each device.interfaces as iface, index (iface.index)}
      <label class="nat">
        <input type="checkbox" checked={!!iface.cgnat} disabled={!editor.editable} onchange={(e) => editor.setCgnat(device.id, index, e.currentTarget.checked)} />
        {t('cgnat.customerPort', { iface: interfaceLabel(device, index) })}
      </label>
    {/each}
  </details>
{/if}

{#if device.type === 'router' && ui.has('net.nat')}
  <details class="section" open={device.interfaces.some((i) => i.nat)} data-help="nat">
  <summary>{t('nat.title')}</summary>
  <p class="muted small-text">{t('nat.hint')}</p>
  {#each device.interfaces as iface, index (iface.index)}
    <label class="nat">
      <input type="checkbox" checked={!!iface.nat} onchange={(e) => editor.setInterfaceNat(device.id, index, e.currentTarget.checked)} />
      {t('nat.outsideIface', { iface: interfaceLabel(device, index) })}
    </label>
  {/each}

  {#if device.interfaces.some((i) => i.nat)}
    <h4>{t('nat.forwards')}</h4>
    {#each device.portForwards ?? [] as forward, i (i)}
      <div class="forward">
        <span class="mono">{forward.protocol.toUpperCase()} :{forward.port} → {forward.to}:{forward.toPort}</span>
        <button class="small" onclick={() => editor.removePortForward(device.id, i)} aria-label={t('nat.removeForward')}>✕</button>
      </div>
    {/each}
    <form class="add-forward" onsubmit={addForward}>
      <select bind:value={forwardDraft.protocol} aria-label={t('nat.protocol')}>
        <option value="tcp">TCP</option>
        <option value="udp">UDP</option>
      </select>
      <input bind:value={forwardDraft.port} inputmode="numeric" placeholder="80" aria-label={t('nat.port')} />
      <input bind:value={forwardDraft.to} placeholder="192.168.0.20" aria-label={t('nat.to')} autocomplete="off" spellcheck="false" />
      <input bind:value={forwardDraft.toPort} inputmode="numeric" placeholder="80" aria-label={t('nat.toPort')} />
      <button type="submit" disabled={!forwardDraft.to.trim()} aria-label={t('nat.addForward')} title={t('nat.addForward')}>+</button>
    </form>
    {#if forwardError}
      <p class="error" role="alert">{forwardError}</p>
    {/if}

    {#if ui.has('net.staticNat')}
      <h4 data-help="staticNat">{t('nat.static')}</h4>
      <p class="muted small-text">{t('nat.staticHint')}</p>
      {#each device.staticNat ?? [] as rule, i (i)}
        <div class="forward">
          <span class="mono">{rule.inside} ⇄ {rule.outside}</span>
          <button class="small" disabled={!editor.editable} onclick={() => editor.removeStaticNat(device.id, i)} aria-label={t('nat.removeStatic')}>✕</button>
        </div>
      {/each}
      <form class="add-static" onsubmit={addStatic}>
        <input bind:value={staticDraft.inside} placeholder="192.168.0.80" aria-label={t('nat.inside')} disabled={!editor.editable} />
        <span>⇄</span>
        <input bind:value={staticDraft.outside} placeholder="203.0.113.5" aria-label={t('nat.outside')} disabled={!editor.editable} />
        <button type="submit" disabled={!editor.editable || !staticDraft.inside.trim() || !staticDraft.outside.trim()}>+</button>
      </form>
      {#if staticError}<p class="error" role="alert">{staticError}</p>{/if}
    {/if}
  {/if}
  </details>
{/if}

{#if ui.has('net.dhcpRelay') && !routesOnly && device.type !== 'internet'}
<details class="section" open={device.interfaces.some((i) => i.dhcpRelay)} data-help="dhcp">
<summary>{t('router.relay')}</summary>
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
</details>
{/if}

{#if ui.has('routing.static')}
<details class="section" open data-help="routing">
<summary>{t('router.staticRoutes')}</summary>
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
        {#each logicalInterfaces(device) as id (id)}
          <option value={String(id)}>{interfaceLabel(device, id)}</option>
        {/each}
      </select>
    </label>
  </div>
  {#if routeError}
    <p class="error" role="alert">{routeError.text}</p>
  {/if}
  <button type="submit" disabled={!editor.editable || !route.network.trim() || !route.mask.trim()}>{t('router.addRoute')}</button>
</form>
</details>
{/if}

<RoutingProtocols {device} />

<RoutingTable {device} />

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .section {
    margin-top: 10px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .section summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 4px;
  }
  .kind {
    display: flex;
    gap: 4px;
    margin: 8px 0 -2px 2.9rem;
  }
  .kind select {
    width: auto;
    font-size: 0.75rem;
    padding: 1px 4px;
  }
  .calc {
    display: grid;
    place-items: center;
    padding: 3px 5px !important;
  }
  .add-static {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
  }
  .nat {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    margin-top: 2px;
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 0.8rem;
  }
  .forward {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
  }
  .add-forward {
    display: grid;
    grid-template-columns: 4rem 3.5rem minmax(0, 1fr) 3.5rem auto;
    gap: 4px;
    margin-top: 4px;
  }
  .add-forward button {
    padding: 3px 8px;
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
    grid-template-columns: 2.6rem minmax(0, 1fr) 4.2rem auto auto;
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
