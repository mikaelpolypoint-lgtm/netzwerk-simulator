<script lang="ts">
  import { cableAt, getDevice, otherEnd, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';

  /** Entwurfsmodus, Switch: Spanning Tree und VLAN pro Port. */
  let { device }: { device: Device } = $props();

  const PRIORITIES = Array.from({ length: 16 }, (_, i) => i * 4096);

  const peerOf = (index: number) => {
    const cable = cableAt(editor.topology, { device: device.id, iface: index });
    if (!cable) return '';
    return getDevice(editor.topology, otherEnd(cable, device.id).device)?.name ?? '';
  };

  function setVlan(index: number, value: string) {
    const vlan = Number(value);
    if (Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094) editor.setPortVlan(device.id, index, vlan);
  }
</script>

{#if !ui.pro}
<p class="muted">{t('switch.basicHint')}</p>
{:else}
<h3>{t('switch.stp')}</h3>
<label class="toggle">
  <input type="checkbox" checked={!!device.stp} onchange={(e) => editor.setStp(device.id, e.currentTarget.checked)} />
  {t('switch.stpEnable')}
</label>
{#if device.stp}
  <label class="row">
    <span>{t('switch.priority')}</span>
    <select value={device.stpPriority ?? 32768} onchange={(e) => editor.setStpPriority(device.id, Number(e.currentTarget.value))}>
      {#each PRIORITIES as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </select>
  </label>
{/if}
<p class="muted">{t('switch.stpHint')}</p>

<h3>{t('switch.vlans')}</h3>
<table>
  <thead>
    <tr>
      <th scope="col">{t('switch.port')}</th>
      <th scope="col">{t('switch.vlan')}</th>
      <th scope="col">{t('switch.trunk')}</th>
      <th scope="col"><span class="visually-hidden">{t('switch.peer')}</span></th>
    </tr>
  </thead>
  <tbody>
    {#each device.interfaces as iface (iface.index)}
      <tr>
        <th scope="row">{interfaceLabel(device, iface.index)}</th>
        <td>
          <input
            class="vlan"
            type="number"
            min="1"
            max="4094"
            value={iface.vlan ?? 1}
            disabled={!!iface.trunk}
            aria-label={t('switch.vlanOf', { port: interfaceLabel(device, iface.index) })}
            onchange={(e) => setVlan(iface.index, e.currentTarget.value)}
          />
        </td>
        <td>
          <input
            type="checkbox"
            checked={!!iface.trunk}
            aria-label={t('switch.trunkOf', { port: interfaceLabel(device, iface.index) })}
            onchange={(e) => editor.setPortTrunk(device.id, iface.index, e.currentTarget.checked)}
          />
        </td>
        <td class="muted">{peerOf(iface.index)}</td>
      </tr>
    {/each}
  </tbody>
</table>
<p class="muted">{t('switch.vlanHint')}</p>
{/if}

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .toggle,
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 6px;
  }
  .row {
    justify-content: space-between;
  }
  select,
  .vlan {
    font: inherit;
    font-size: 0.8rem;
    padding: 2px 4px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .vlan {
    width: 4.5em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th,
  td {
    text-align: left;
    padding: 2px 4px;
    border-bottom: 1px solid var(--border);
  }
  thead th {
    color: var(--muted);
    font-weight: normal;
  }
  .muted {
    color: var(--muted);
    font-size: 0.75rem;
  }
  p.muted {
    margin: 4px 0 0;
  }
</style>
