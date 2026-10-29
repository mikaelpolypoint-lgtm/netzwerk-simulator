<script lang="ts">
  import { DEVICE_SPECS, MAX_NAME_LENGTH, canHostServices, canUseWifi, convert, copperPorts, devicePrice, floorsOf, hasCli, isRackable, isRouterType, isSwitchType } from '../../core';
  import { t } from '../../i18n';
  import { roleLabel, typeLabel } from '../labels';
  import { openCli } from '../state/cli.svelte';
  import { dialogs } from '../state/dialogs.svelte';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import AreaForm from './AreaForm.svelte';
  import CableInspector from './CableInspector.svelte';
  import GroupConfig from './GroupConfig.svelte';
  import HostConfigForm from './HostConfigForm.svelte';
  import HostPanel from './HostPanel.svelte';
  import Icon from './Icon.svelte';
  import MailAccountForm from './MailAccountForm.svelte';
  import ModemConfig from './ModemConfig.svelte';
  import NetDevicePanel from './NetDevicePanel.svelte';
  import PortPanel from './PortPanel.svelte';
  import PortTable from './PortTable.svelte';
  import RouterConfig from './RouterConfig.svelte';
  import Services from './Services.svelte';
  import SviConfig from './SviConfig.svelte';
  import SwitchConfig from './SwitchConfig.svelte';
  import WifiClientForm from './WifiClientForm.svelte';
  import WlanConfig from './WlanConfig.svelte';

  /**
   * Eigenschaften der Auswahl. Was angezeigt wird, hängt vom Gerät, vom Modus
   * und vom Funktionsumfang ab; seltene Einstellungen sind aufklappbar.
   */
  const device = $derived(editor.selectedDevice);
  const cable = $derived(editor.selectedCable);
  const area = $derived(editor.selectedArea);
  const floors = $derived(floorsOf(editor.topology));
  const copper = $derived(device ? copperPorts(device).length : 0);
  const racks = $derived((editor.topology.areas ?? []).filter((a) => a.kind === 'rack'));
  const spec = $derived(device ? DEVICE_SPECS[device.type] : undefined);
  const money = (chf: number) => `${ui.currency} ${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(convert(chf, ui.currency))}`;

  let nameDraft = $state('');
  $effect(() => {
    nameDraft = device?.name ?? '';
  });

  function commitName() {
    if (device && !editor.rename(device.id, nameDraft)) nameDraft = device.name;
  }

  function onNameKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      nameDraft = device?.name ?? '';
      event.currentTarget.blur();
    }
  }
</script>

<aside class="inspector" aria-labelledby="inspector-title">
  <div class="head">
    <h2 id="inspector-title">{t('inspector.title')}</h2>
    <button class="help" onclick={() => dialogs.showHelp(device ? `device.${device.type}` : cable ? 'cables' : area ? 'areas' : 'overview')} title={t('help.contextHint')} aria-label={t('menu.help.help')}><Icon name="help" size={16} /></button>
  </div>

  {#if device && spec}
    <label class="field">
      <span>{t('inspector.name')}</span>
      <input id="inspector-name" type="text" maxlength={MAX_NAME_LENGTH} bind:value={nameDraft} disabled={!editor.editable} onchange={commitName} onkeydown={onNameKeydown} />
    </label>
    <dl class="facts">
      <dt>{t('inspector.type')}</dt>
      <dd>{typeLabel(device.type)}{device.variant === 'rack' ? ` (${t('shop.serverRack')})` : ''}</dd>
      <dt>{t('inspector.role')}</dt>
      <dd>{roleLabel(device.type)}</dd>
      {#if ui.has('tool.costs') && devicePrice(device) > 0}
        <dt>{t('costs.price')}</dt>
        <dd>{money(devicePrice(device))}</dd>
      {/if}
    </dl>

    {#if floors.length > 1 && ui.has('tool.floors')}
      <label class="field">
        <span>{t('floor.label')}</span>
        <select value={device.floor ?? 0} disabled={!editor.editable} onchange={(e) => editor.setDeviceFloor(device.id, Number(e.currentTarget.value))}>
          {#each floors as f, i (i)}<option value={i}>{f.name}</option>{/each}
        </select>
      </label>
    {/if}

    {#if isRackable(device.type) && racks.length > 0 && ui.has('tool.racks')}
      <label class="field">
        <span>{t('rack.mount')}</span>
        <select value={device.rack ?? ''} disabled={!editor.editable} onchange={(e) => editor.setDeviceRack(device.id, e.currentTarget.value || null)}>
          <option value="">{t('rack.notMounted')}</option>
          {#each racks as r (r.id)}<option value={r.id}>{r.title}</option>{/each}
        </select>
      </label>
    {/if}

    {#if hasCli(device.type) && ui.has('net.cli')}
      <button class="cli" onclick={() => openCli(device.id)} title={t('cli.openHint')}>›_ {t('cli.open')}</button>
    {/if}

    {#if spec.role === 'endpoint'}
      {#if editor.acting}
        <HostPanel {device} />
        {#if device.type === 'clientgroup'}<GroupConfig {device} />{/if}
      {:else if device.type === 'clientgroup'}
        <GroupConfig {device} />
      {:else}
        <HostConfigForm {device} />
        {#if canUseWifi(device) && ui.has('medium.wireless')}
          <details class="sub" open={!!device.wifi} data-help="wlan">
            <summary>{t('wifi.title')}</summary>
            <WifiClientForm {device} />
          </details>
        {/if}
        {#if ui.has('service.mail')}
          <details class="sub" open={!!device.mailAccount} data-help="mail">
            <summary>{t('mailAccount.title')}</summary>
            <MailAccountForm {device} />
          </details>
        {/if}
        {#if canHostServices(device.type)}
          <Services {device} />
        {/if}
      {/if}
    {:else if device.type === 'modem'}
      <ModemConfig {device} />
    {:else if editor.acting}
      <NetDevicePanel {device} />
    {:else if isRouterType(device.type)}
      <RouterConfig {device} />
    {:else if device.type === 'l3switch'}
      <SviConfig {device} />
      <SwitchConfig {device} />
      <RouterConfig {device} routesOnly />
    {:else if device.type === 'switch'}
      <SwitchConfig {device} />
    {:else if device.type === 'accesspoint'}
      <WlanConfig {device} />
    {/if}

    {#if editor.acting && (isSwitchType(device.type) || device.type === 'accesspoint') && ui.has('net.stp') && device.type !== 'accesspoint'}
      <SwitchConfig {device} />
    {/if}

    {#if spec.minInterfaces !== spec.maxInterfaces && editor.editable}
      <div class="field">
        <span id="port-count">{t('inspector.portCount')}</span>
        <div class="stepper" role="group" aria-labelledby="port-count">
          <button aria-label={t('inspector.portLess')} disabled={copper <= spec.minInterfaces} onclick={() => editor.setInterfaceCount(device.id, copper - 1)}>−</button>
          <output aria-live="polite">{copper}</output>
          <button aria-label={t('inspector.portMore')} disabled={copper >= spec.maxInterfaces} onclick={() => editor.setInterfaceCount(device.id, copper + 1)}>+</button>
        </div>
      </div>
    {/if}

    {#if isSwitchType(device.type) || device.type === 'router'}
      <h3>{t('panel.title')}</h3>
      <PortPanel {device} />
    {/if}

    <details class="sub" open={!editor.acting || ui.has('net.portShutdown')}>
      <summary>{t('inspector.interfaces')}</summary>
      <PortTable {device} />
    </details>

    {#if editor.editable}
      <div class="actions">
        <button onclick={() => editor.duplicateSelection()} title={t('menu.edit.duplicate')}><Icon name="copy" size={15} /> {t('menu.edit.duplicate')}</button>
        <button class="danger" onclick={() => editor.deleteSelection()}><Icon name="trash" size={15} /> {t('inspector.delete')}</button>
      </div>
    {/if}
  {:else if cable}
    <CableInspector {cable} />
  {:else if area}
    <AreaForm {area} />
  {:else}
    <div class="empty">
      <p class="muted">{t('inspector.nothing')}</p>
      <ol class="steps">
        <li>{t('inspector.step1')}</li>
        <li>{t('inspector.step2')}</li>
        <li>{t('inspector.step3')}</li>
        <li>{t('inspector.step4')}</li>
      </ol>
      <button class="link" onclick={() => dialogs.show('shortcuts')}>{t('menu.help.shortcuts')}</button>
      <button class="link" onclick={() => dialogs.showHelp('overview')}>{t('menu.help.guide')}</button>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    padding: 12px;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head .help {
    border: none;
    background: none;
    color: var(--muted);
    padding: 2px;
  }
  .sub {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 8px 0;
    padding: 0 8px 4px;
  }
  .sub summary {
    cursor: pointer;
    padding: 6px 0;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 12px;
  }
  .actions button {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .empty .steps {
    margin: 8px 0 12px;
    padding-left: 1.2em;
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .link {
    display: block;
    border: none;
    background: none;
    padding: 2px 0;
    color: var(--accent);
    text-decoration: underline;
    font-size: 0.82rem;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 0.95rem;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .field {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
    font-size: 0.85rem;
  }
  input {
    font: inherit;
    font-size: 0.95rem;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 12px;
    font-size: 0.85rem;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stepper button {
    width: 32px;
  }
  .stepper output {
    min-width: 2ch;
    text-align: center;
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
  }
  select {
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .cli {
    width: 100%;
    margin-bottom: 8px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    background: var(--console-bg);
    color: var(--console-text);
    border-color: var(--console-bg);
  }
  .cli:hover:not(:disabled) {
    background: #2b3440;
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
