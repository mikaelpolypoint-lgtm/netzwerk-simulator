<script lang="ts">
  import { SFP_MODULES, cableAt, getDevice, linkStatus, otherEnd, type Device, type SfpModule, type TagColor } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { TAG_HEX, TAG_ORDER } from '../tags';

  /**
   * Anschlüsse eines Geräts: Link-Status (grün/rot), Farbtag, Gegenstelle,
   * Beschreibung und – im Entwurfsmodus – ein/aus («shutdown»).
   */
  let { device }: { device: Device } = $props();

  const canTag = $derived(editor.editable || editor.documenting);
  let open = $state<number | null>(null);

  const rows = $derived(
    device.interfaces.map((iface) => {
      const cable = cableAt(editor.topology, { device: device.id, iface: iface.index });
      const status = cable ? linkStatus(editor.topology, cable) : null;
      const end = cable ? otherEnd(cable, device.id) : null;
      const peer = end ? getDevice(editor.topology, end.device) : undefined;
      return {
        iface,
        status,
        peer: peer && end ? t('inspector.connectedTo', { device: peer.name, iface: interfaceLabel(peer, end.iface) }) : null,
      };
    }),
  );

  function ledTitle(status: (typeof rows)[number]['status']): string {
    if (!status) return t('link.none');
    return status.up ? t('link.up') : t(`link.down.${status.reason ?? 'unknown'}`);
  }
</script>

<table>
  <thead>
    <tr>
      <th scope="col"><span class="visually-hidden">{t('link.status')}</span></th>
      <th scope="col">{t('ports.port')}</th>
      <th scope="col">{t('ports.tag')}</th>
      <th scope="col">{t('ports.peer')}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as { iface, status, peer } (iface.index)}
      <tr>
        <td>
          <span class="led" class:up={status?.up} class:down={status && !status.up} title={ledTitle(status)} aria-label={ledTitle(status)} role="img"></span>
        </td>
        <th scope="row">
          <button class="port" onclick={() => (open = open === iface.index ? null : iface.index)} aria-expanded={open === iface.index}>
            {interfaceLabel(device, iface.index)}
          </button>
          {#if iface.description}<span class="desc">{iface.description}</span>{/if}
        </th>
        <td>
          <span class="swatch" style:background={iface.color ? TAG_HEX[iface.color] : 'transparent'}></span>
          {#if canTag}
            <select
              value={iface.color ?? ''}
              aria-label={t('ports.tagOf', { port: interfaceLabel(device, iface.index) })}
              onchange={(e) => editor.setInterfaceColor(device.id, iface.index, (e.currentTarget.value || null) as TagColor | null)}
            >
              <option value="">–</option>
              {#each TAG_ORDER as c (c)}
                <option value={c}>{t(`color.${c}`)}</option>
              {/each}
            </select>
          {:else if iface.color}
            {t(`color.${iface.color}`)}
          {/if}
        </td>
        <td class:free={!peer}>{peer ?? t('inspector.free')}</td>
      </tr>
      {#if open === iface.index}
        <tr class="details">
          <td></td>
          <td colspan="3">
            <div class="mac">MAC {iface.mac}</div>
            <label class="field">
              <span>{t('ports.description')}</span>
              <input
                value={iface.description ?? ''}
                maxlength="80"
                disabled={!canTag}
                onchange={(e) => editor.setInterfaceDescription(device.id, iface.index, e.currentTarget.value)}
              />
            </label>
            {#if iface.sfpSlot}
              <label class="field">
                <span>{t('sfp.module')}</span>
                <select
                  value={iface.sfp ?? ''}
                  disabled={!editor.editable}
                  onchange={(e) => editor.setSfpModule(device.id, iface.index, (e.currentTarget.value || null) as SfpModule | null)}
                >
                  <option value="">{t('sfp.empty')}</option>
                  {#each SFP_MODULES as m (m)}<option value={m}>{m} – {t(`sfp.${m}`)}</option>{/each}
                </select>
              </label>
            {/if}
            <label class="toggle">
              <input
                type="checkbox"
                checked={!iface.shutdown}
                disabled={!editor.editable}
                onchange={(e) => editor.setInterfaceShutdown(device.id, iface.index, !e.currentTarget.checked)}
              />
              {t('ports.enabled')}
            </label>
            {#if status && !status.up}
              <p class="reason">{ledTitle(status)}</p>
            {/if}
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>
<p class="muted">{t('ports.hint')}</p>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th,
  td {
    text-align: left;
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  thead th {
    color: var(--muted);
    font-weight: normal;
  }
  .led {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
  }
  .led.up {
    background: #16a34a;
    box-shadow: 0 0 0 2px color-mix(in srgb, #16a34a 25%, transparent);
  }
  .led.down {
    background: #dc2626;
    box-shadow: 0 0 0 2px color-mix(in srgb, #dc2626 25%, transparent);
  }
  .port {
    padding: 0 2px;
    border: none;
    background: none;
    font-weight: 600;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .desc {
    display: block;
    font-weight: normal;
    font-size: 0.7rem;
    color: var(--muted);
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid var(--border);
    vertical-align: middle;
  }
  select {
    font: inherit;
    font-size: 0.75rem;
    padding: 1px 2px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    max-width: 5.5rem;
  }
  .free {
    color: var(--muted);
  }
  .details td {
    background: var(--surface-2);
  }
  .mac {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.75rem;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
    margin-bottom: 4px;
  }
  .field select {
    font: inherit;
    padding: 2px 4px;
    max-width: none;
  }
  .field input {
    font: inherit;
    padding: 3px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .toggle {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.75rem;
  }
  .reason {
    margin: 4px 0 0;
    color: var(--danger);
    font-size: 0.75rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.7rem;
    margin: 4px 0 12px;
  }
</style>
