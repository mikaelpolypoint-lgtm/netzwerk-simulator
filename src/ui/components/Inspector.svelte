<script lang="ts">
  import { DEVICE_SPECS, MAX_NAME_LENGTH, cableAt, getDevice, otherEnd, type Device, type Endpoint } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel, roleLabel, typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import HostConfigForm from './HostConfigForm.svelte';
  import MailAccountForm from './MailAccountForm.svelte';
  import Services from './Services.svelte';
  import HostPanel from './HostPanel.svelte';
  import NetDevicePanel from './NetDevicePanel.svelte';
  import RouterConfig from './RouterConfig.svelte';

  const device = $derived(editor.selectedDevice);
  const cable = $derived(editor.selectedCable);
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

  function describe(endpoint: Endpoint): string {
    const d = getDevice(editor.topology, endpoint.device);
    return d ? `${d.name} (${interfaceLabel(d, endpoint.iface)})` : '?';
  }

  function peer(d: Device, index: number): string | undefined {
    const c = cableAt(editor.topology, { device: d.id, iface: index });
    if (!c) return undefined;
    const end = otherEnd(c, d.id);
    const other = getDevice(editor.topology, end.device);
    return other ? t('inspector.connectedTo', { device: other.name, iface: interfaceLabel(other, end.iface) }) : undefined;
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

    {#if spec.role === 'endpoint'}
      {#if editor.editable}
        <HostConfigForm {device} />
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
    {:else if !editor.editable}
      <NetDevicePanel {device} />
    {:else if device.type === 'router'}
      <RouterConfig {device} />
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

    <h3>{t('inspector.interfaces')}</h3>
    <table>
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">{t('inspector.mac')}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        {#each device.interfaces as iface (iface.index)}
          {@const link = peer(device, iface.index)}
          <tr>
            <th scope="row">{interfaceLabel(device, iface.index)}</th>
            <td class="mono">{iface.mac}</td>
            <td class:free={!link}>{link ?? t('inspector.free')}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if editor.editable}
      <button class="danger" onclick={() => editor.deleteSelection()}>{t('inspector.delete')}</button>
    {/if}
  {:else if cable}
    <dl class="facts">
      <dt>{t('inspector.type')}</dt>
      <dd>{t('inspector.cable')}</dd>
      <dt>{t('inspector.endpoints')}</dt>
      <dd>{describe(cable.a)}<br />{describe(cable.b)}</dd>
    </dl>
    <button class="danger" disabled={!editor.editable} onclick={() => editor.deleteSelection()}>
      {t('inspector.delete')}
    </button>
  {:else}
    <p class="muted">{t('inspector.nothing')}</p>
    <h3>{t('inspector.shortcuts')}</h3>
    <dl class="shortcuts">
      {#each shortcuts as [keys, label] (label)}
        <dt><kbd>{keys}</kbd></dt>
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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    margin-bottom: 16px;
  }
  th,
  td {
    text-align: left;
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  thead th {
    color: var(--muted);
    font-weight: normal;
  }
  td:last-child {
    white-space: normal;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .free,
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
