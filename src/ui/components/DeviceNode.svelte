<script lang="ts">
  import { DEVICE_SPECS, parseMask, type Device } from '../../core';
  import { t } from '../../i18n';
  import { typeLabel } from '../labels';
  import { openDesktop } from '../state/desktop.svelte';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import DeviceIcon from './DeviceIcon.svelte';

  let {
    device,
    onpointerdown,
  }: {
    device: Device;
    onpointerdown: (event: PointerEvent, device: Device) => void;
  } = $props();

  const selected = $derived(editor.selection?.kind === 'device' && editor.selection.id === device.id);
  const isSource = $derived(editor.cableSource === device.id);
  const isEndpoint = $derived(DEVICE_SPECS[device.type].role === 'endpoint');

  /** Endgeräte zeigen ihre Adresse direkt auf der Zeichenfläche; per DHCP bezogene erst im Aktionsmodus. */
  const ip = $derived.by(() => {
    if (!isEndpoint) return '';
    const live = device.dhcp && !editor.editable ? (simStore.tick, simStore.sim?.getDeviceState(device.id).address) : undefined;
    const address = device.dhcp ? live?.ip : device.interfaces[0]?.ip;
    const mask = device.dhcp ? live?.mask : device.interfaces[0]?.mask;
    if (!address) return device.dhcp ? t('canvas.dhcp') : '';
    const prefix = mask ? parseMask(mask) : null;
    return prefix === null ? address : `${address}/${prefix}`;
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (editor.tool === 'cable') editor.cableClick(device.id);
    else editor.select({ kind: 'device', id: device.id });
  }

  /** Doppelklick im Aktionsmodus öffnet den Desktop des Endgeräts. */
  function ondblclick() {
    if (!editor.editable && isEndpoint) openDesktop(device.id);
  }
</script>

<g
  class="device role-{DEVICE_SPECS[device.type].role}"
  class:selected
  class:source={isSource}
  transform="translate({device.position.x} {device.position.y})"
  role="button"
  tabindex="0"
  aria-pressed={selected}
  aria-label={t('canvas.device', { name: device.name, type: typeLabel(device.type) })}
  onpointerdown={(e) => onpointerdown(e, device)}
  onfocus={() => editor.tool === 'select' && editor.select({ kind: 'device', id: device.id })}
  {onkeydown}
  {ondblclick}
>
  <rect class="hit" x="-36" y="-30" width="72" height="60" rx="10" />
  <DeviceIcon type={device.type} />
  <text class="label" y="44">{device.name}</text>
  {#if ip}
    <text class="ip" y="59">{ip}</text>
  {/if}
</g>

<style>
  .device {
    cursor: pointer;
    outline: none;
  }
  .hit {
    fill: transparent;
    stroke: transparent;
    stroke-width: 2;
  }
  .device:hover .hit {
    fill: var(--hover);
  }
  .selected .hit {
    fill: var(--selected-soft);
    stroke: var(--accent);
  }
  .source .hit {
    stroke: var(--accent);
    stroke-dasharray: 5 4;
  }
  .device:focus-visible .hit {
    stroke: var(--focus);
    stroke-width: 3;
  }
  .ip {
    font-size: 11px;
    text-anchor: middle;
    fill: var(--muted);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    user-select: none;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    text-anchor: middle;
    fill: var(--text);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    user-select: none;
  }
</style>
