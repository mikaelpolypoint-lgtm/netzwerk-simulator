<script lang="ts">
  import { DEVICE_SPECS, type Device } from '../../core';
  import { t } from '../../i18n';
  import { typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
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

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (editor.tool === 'cable') editor.cableClick(device.id);
    else editor.select({ kind: 'device', id: device.id });
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
>
  <rect class="hit" x="-36" y="-30" width="72" height="60" rx="10" />
  <DeviceIcon type={device.type} />
  <text class="label" y="44">{device.name}</text>
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
