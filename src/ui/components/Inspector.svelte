<script lang="ts">
  import { DEVICE_SPECS, MAX_NAME_LENGTH, canUseWifi, floorsOf, hasCli, isRouterType, isSwitchType } from '../../core';
  import { t } from '../../i18n';
  import { roleLabel, typeLabel } from '../labels';
  import { openCli } from '../state/cli.svelte';
  import { editor } from '../state/editor.svelte';
  import AreaForm from './AreaForm.svelte';
  import CableInspector from './CableInspector.svelte';
  import PortPanel from './PortPanel.svelte';
  import PortTable from './PortTable.svelte';
  import SviConfig from './SviConfig.svelte';
  import WifiClientForm from './WifiClientForm.svelte';
  import WlanConfig from './WlanConfig.svelte';
  import HostConfigForm from './HostConfigForm.svelte';
  import MailAccountForm from './MailAccountForm.svelte';
  import Services from './Services.svelte';
  import SwitchConfig from './SwitchConfig.svelte';
  import HostPanel from './HostPanel.svelte';
  import NetDevicePanel from './NetDevicePanel.svelte';
  import RouterConfig from './RouterConfig.svelte';

  const device = $derived(editor.selectedDevice);
  const cable = $derived(editor.selectedCable);
  const area = $derived(editor.selectedArea);
  const floors = $derived(floorsOf(editor.topology));
  const spec = $derived(device ? DEVICE_SPECS[device.type] : undefined);

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


  const shortcuts: [string, string][] = [
    ['K', 'shortcut.cable'],
    ['← ↑ → ↓', 'shortcut.move'],
    ['F2', 'shortcut.rename'],
    ['Entf', 'shortcut.delete'],
    ['Strg+Z / Strg+Y', 'shortcut.undo'],
    ['+ / − / 0', 'shortcut.zoom'],
    ['Strg+S / Strg+O', 'shortcut.file'],
    ['Esc', 'shortcut.cancel'],
  ];
</script>

<aside class="inspector" aria-labelledby="inspector-title">
  <h2 id="inspector-title">{t('inspector.title')}</h2>

  {#if device && spec}
    <label class="field">
      <span>{t('inspector.name')}</span>
      <input
        id="inspector-name"
        type="text"
        maxlength={MAX_NAME_LENGTH}
        bind:value={nameDraft}
        disabled={!editor.editable}
        onchange={commitName}
        onkeydown={onNameKeydown}
      />
    </label>
    <dl class="facts">
      <dt>{t('inspector.type')}</dt>
      <dd>{typeLabel(device.type)}</dd>
      <dt>{t('inspector.role')}</dt>
      <dd>{roleLabel(device.type)}</dd>
    </dl>

    {#if floors.length > 1}
      <label class="field">
        <span>{t('floor.label')}</span>
        <select value={device.floor ?? 0} disabled={!editor.editable} onchange={(e) => editor.setDeviceFloor(device.id, Number(e.currentTarget.value))}>
          {#each floors as f, i (i)}<option value={i}>{f.name}</option>{/each}
        </select>
      </label>
    {/if}

    {#if hasCli(device.type) && !editor.documenting}
      <button class="cli" onclick={() => openCli(device.id)} title={t('cli.openHint')}>›_ {t('cli.open')}</button>
    {/if}

    {#if editor.documenting}
      <p class="muted">{t('doc.deviceHint')}</p>
    {:else if spec.role === 'endpoint'}
      {#if editor.editable}
        <HostConfigForm {device} />
        {#if canUseWifi(device)}
          <details class="mail-account" open={!!device.wifi}>
            <summary>{t('wifi.title')}</summary>
            <WifiClientForm {device} />
          </details>
        {/if}
        <details class="mail-account" open={!!device.mailAccount}>
          <summary>{t('mailAccount.title')}</summary>
          <MailAccountForm {device} />
        </details>
        {#if device.type === 'pc'}
          <Services {device} />
        {/if}
      {:else}
        <HostPanel {device} />
      {/if}
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

    {#if spec.minInterfaces !== spec.maxInterfaces && editor.editable}
      <div class="field">
        <span id="port-count">{t('inspector.portCount')}</span>
        <div class="stepper" role="group" aria-labelledby="port-count">
          <button
            aria-label={t('inspector.portLess')}
            disabled={!editor.editable || device.interfaces.length <= spec.minInterfaces}
            onclick={() => editor.setInterfaceCount(device.id, device.interfaces.length - 1)}>−</button
          >
          <output aria-live="polite">{device.interfaces.length}</output>
          <button
            aria-label={t('inspector.portMore')}
            disabled={!editor.editable || device.interfaces.length >= spec.maxInterfaces}
            onclick={() => editor.setInterfaceCount(device.id, device.interfaces.length + 1)}>+</button
          >
        </div>
      </div>
    {/if}

    {#if isSwitchType(device.type) || device.type === 'router'}
      <h3>{t('panel.title')}</h3>
      <PortPanel {device} />
    {/if}

    <h3>{t('inspector.interfaces')}</h3>
    <PortTable {device} />

    {#if editor.editable}
      <button class="danger" onclick={() => editor.deleteSelection()}>{t('inspector.delete')}</button>
    {/if}
  {:else if cable}
    <CableInspector {cable} />
  {:else if area}
    <AreaForm {area} />
  {:else}
    <p class="muted">{t('inspector.nothing')}</p>
    <h3>{t('inspector.shortcuts')}</h3>
    <dl class="shortcuts">
      {#each shortcuts as [keys, label] (label)}
        <dt><kbd>{keys.replaceAll('Strg', t('key.ctrl')).replace('Entf', t('key.delete'))}</kbd></dt>
        <dd>{t(label)}</dd>
      {/each}
    </dl>
  {/if}
</aside>

<style>
  .inspector {
    padding: 12px;
    overflow-y: auto;
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
  .mail-account {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 0 0 6px;
    padding: 0 8px;
  }
  .mail-account summary {
    cursor: pointer;
    padding: 5px 0;
    font-size: 0.85rem;
    font-weight: 600;
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
    margin-top: 12px;
    color: var(--danger);
    border-color: var(--danger);
  }
  .shortcuts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 10px;
    margin: 0;
    font-size: 0.8rem;
    align-items: baseline;
  }
  .shortcuts dd {
    margin: 0;
  }
  kbd {
    font-family: inherit;
    font-size: 0.75rem;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-2);
    white-space: nowrap;
  }
</style>
