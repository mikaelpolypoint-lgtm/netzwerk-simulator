<script lang="ts">
  import { DEVICE_SPECS, addressScope, floorsOf, hasCli, parseIp, parseMask, type AddressScope, type Device } from '../../core';
  import { t } from '../../i18n';
  import { typeLabel } from '../labels';
  import { openCli } from '../state/cli.svelte';
  import { openDesktop } from '../state/desktop.svelte';
  import { ui } from '../state/ui.svelte';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import DeviceIcon from './DeviceIcon.svelte';

  let {
    device,
    onpointerdown,
    faded = false,
    racked = false,
  }: {
    device: Device;
    onpointerdown: (event: PointerEvent, device: Device) => void;
    faded?: boolean;
    /** Im Rack eingebaut: mit Frontplatte (1 Höheneinheit) dargestellt. */
    racked?: boolean;
  } = $props();

  /** Stockwerk-Kürzel, wenn mehrere Stockwerke existieren und alle angezeigt werden. */
  const floorLabel = $derived.by(() => {
    const floors = floorsOf(editor.topology);
    if (floors.length < 2 || ui.floor !== 'all') return '';
    return floors[device.floor ?? 0]?.name ?? '';
  });

  const selected = $derived(editor.selection?.kind === 'device' && editor.selection.id === device.id);
  const isSource = $derived(editor.cableSource === device.id);
  const isEndpoint = $derived(DEVICE_SPECS[device.type].role === 'endpoint');

  /** Endgeräte zeigen ihre Adresse direkt auf der Zeichenfläche; per DHCP bezogene erst in der Simulation. */
  const ip = $derived.by(() => {
    if (!isEndpoint) return '';
    const live = device.dhcp && editor.acting ? (simStore.tick, simStore.sim?.getDeviceState(device.id).address) : undefined;
    const address = device.dhcp ? live?.ip : device.interfaces[0]?.ip;
    const mask = device.dhcp ? live?.mask : device.interfaces[0]?.mask;
    if (!address) return device.dhcp ? t('canvas.dhcp') : '';
    const prefix = mask ? parseMask(mask) : null;
    return prefix === null ? address : `${address}/${prefix}`;
  });

  /** Mit «IP-Adressen anzeigen» (A): Adressen farbig nach Art, bei Routern alle Schnittstellen. */
  const badges = $derived(ui.has('tool.addressBadges') && ui.showAddresses);
  const scopeOf = (text: string): AddressScope | null => {
    const n = parseIp(text.split('/')[0] ?? '');
    return n === null ? null : addressScope(n);
  };
  const lines = $derived.by((): { text: string; scope: AddressScope | null }[] => {
    if (isEndpoint) return ip ? [{ text: ip, scope: badges ? scopeOf(ip) : null }] : [];
    if (!badges) return [];
    return device.interfaces
      .filter((i) => i.ip)
      .slice(0, 4)
      .map((i) => {
        const prefix = i.mask ? parseMask(i.mask) : null;
        const text = prefix === null ? i.ip! : `${i.ip}/${prefix}`;
        return { text, scope: scopeOf(text) };
      });
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (editor.tool === 'cable') editor.cableClick(device.id);
    else editor.select({ kind: 'device', id: device.id });
  }

  /** Doppelklick: in der Simulation Desktop des Endgeräts; Router und Switches öffnen ihre Befehlszeile. */
  function ondblclick() {
    if (editor.acting && isEndpoint) openDesktop(device.id);
    else if (hasCli(device.type) && ui.has('net.cli')) openCli(device.id);
  }
</script>

<g
  class="device role-{DEVICE_SPECS[device.type].role}"
  class:selected
  class:source={isSource}
  class:faded
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
  {#if racked}
    <rect class="plate" x="-86" y="-28" width="172" height="56" rx="3" />
    <circle class="screw" cx="-80" cy="-21" r="2" />
    <circle class="screw" cx="-80" cy="21" r="2" />
    <circle class="screw" cx="80" cy="-21" r="2" />
    <circle class="screw" cx="80" cy="21" r="2" />
  {/if}
  <rect class="hit" x="-36" y="-30" width="72" height="60" rx="10" />
  <DeviceIcon type={device.type} />
  {#if racked}
    <text class="rack-label" x="-74" y="4">{device.name}</text>
  {:else}
    <text class="label" y="44">{device.name}</text>
  {/if}
  {#each lines as line, i (i)}
    <text class="ip scope-{line.scope ?? 'none'}" y={59 + i * 13}>
      {line.text}
      {#if line.scope}<title>{t(`scope.${line.scope}.hint`)}</title>{/if}
    </text>
  {/each}
  {#if floorLabel}
    <g class="floor" transform="translate(30 -26)">
      <rect x="-2" y="-9" width={floorLabel.length * 6.5 + 8} height="15" rx="4" />
      <text x="2" y="2">{floorLabel}</text>
    </g>
  {/if}
</g>

<style>
  .device {
    cursor: pointer;
    outline: none;
  }
  .faded {
    opacity: 0.18;
  }
  .plate {
    fill: #2b3440;
    stroke: #475569;
    stroke-width: 1.5;
  }
  .screw {
    fill: #64748b;
  }
  .rack-label {
    font-size: 11px;
    font-weight: 600;
    fill: #e2e8f0;
    user-select: none;
    pointer-events: none;
  }
  .floor rect {
    fill: var(--surface-2);
    stroke: var(--border);
  }
  .floor text {
    font-size: 10px;
    fill: var(--muted);
    user-select: none;
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
  .ip.scope-private {
    fill: #2563eb;
  }
  .ip.scope-public {
    fill: #16a34a;
    font-weight: 700;
  }
  .ip.scope-cgnat {
    fill: #d97706;
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
