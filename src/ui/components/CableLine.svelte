<script lang="ts">
  import { isSwitchType, linkStatus, mediumOf, type Cable, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import { TAG_HEX } from '../tags';

  let { cable, a, b, faded = false }: { cable: Cable; a: Device; b: Device; faded?: boolean } = $props();

  /** Abstand der Status-LED vom Gerätemittelpunkt. */
  const LED_DISTANCE = 40;

  const medium = $derived(mediumOf(cable));
  const status = $derived(linkStatus(editor.topology, cable));

  /** Abstand der Port-Beschriftung vom Gerätemittelpunkt, ausserhalb des Gerätenamens. */
  const LABEL_DISTANCE = 76;

  const selected = $derived(editor.selection?.kind === 'cable' && editor.selection.id === cable.id);

  /** Port-Beschriftung mit VLAN bzw. Trunk, damit die Aufteilung auf der Zeichenfläche sichtbar ist. */
  function portLabel(device: Device, index: number): string {
    const base = interfaceLabel(device, index);
    const iface = device.interfaces[index];
    if (!isSwitchType(device.type) || !iface) return base;
    if (iface.trunk) return `${base} · ${t('switch.trunkShort')}`;
    return iface.vlan ? `${base} · V${iface.vlan}` : base;
  }

  const labelA = $derived(portLabel(a, cable.a.iface));
  const labelB = $derived(portLabel(b, cable.b.iface));

  // Im Aktionsmodus: Ist ein Ende durch Spanning Tree blockiert?
  const blocked = $derived.by(() => {
    if (!editor.acting) return false;
    void simStore.tick;
    return ([['a', a], ['b', b]] as const).some(([end, device]) => {
      if (!isSwitchType(device.type) || !device.stp) return false;
      const port = simStore.sim?.getDeviceState(device.id).stp?.ports.find((p) => p.port === cable[end].iface);
      return port?.state === 'blocking';
    });
  });

  const geometry = $derived.by(() => {
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const length = Math.hypot(dx, dy);
    // Liegen die Geräte zu nah beieinander, hätten die Beschriftungen keinen Platz.
    const ux = length ? dx / length : 0;
    const uy = length ? dy / length : 0;
    const leds =
      length > LED_DISTANCE * 2.4
        ? {
            a: { x: a.position.x + ux * LED_DISTANCE, y: a.position.y + uy * LED_DISTANCE },
            b: { x: b.position.x - ux * LED_DISTANCE, y: b.position.y - uy * LED_DISTANCE },
          }
        : null;
    if (length < LABEL_DISTANCE * 2.2) return { length, labels: null, leds };
    return {
      length,
      leds,
      labels: {
        a: { x: a.position.x + ux * LABEL_DISTANCE, y: a.position.y + uy * LABEL_DISTANCE },
        b: { x: b.position.x - ux * LABEL_DISTANCE, y: b.position.y - uy * LABEL_DISTANCE },
      },
    };
  });

  const ledEnds = $derived(
    geometry.leds
      ? [
          { end: 'a' as const, device: a, p: geometry.leds.a },
          { end: 'b' as const, device: b, p: geometry.leds.b },
        ]
      : [],
  );

  function select(event: Event) {
    event.stopPropagation();
    editor.select({ kind: 'cable', id: cable.id });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(event);
    }
  }
</script>

<g
  class="cable medium-{medium}"
  class:selected
  class:down={!status.up}
  class:faded
  role="button"
  tabindex="0"
  aria-pressed={selected}
  aria-label={t('canvas.cable', { a: `${a.name} (${labelA})`, b: `${b.name} (${labelB})` })}
  onpointerdown={select}
  onfocus={() => editor.tool === 'select' && editor.select({ kind: 'cable', id: cable.id })}
  {onkeydown}
>
  <line class="hit" x1={a.position.x} y1={a.position.y} x2={b.position.x} y2={b.position.y} />
  <line class="wire" class:damaged={!!cable.loss} class:blocked x1={a.position.x} y1={a.position.y} x2={b.position.x} y2={b.position.y} />
  {#if medium === 'wireless'}
    <g class="wifi-badge" transform="translate({(a.position.x + b.position.x) / 2} {(a.position.y + b.position.y) / 2})">
      <circle r="11" />
      <path d="M-6 -1 Q0 -7 6 -1 M-3.5 2 Q0 -1.5 3.5 2" />
      <circle class="dotc" cy="5" r="1.4" />
      {#if status.signal !== undefined}
        <text y="22">{status.signal} %</text>
      {/if}
    </g>
  {/if}
  {#if geometry.leds}
    {#each ledEnds as { end, device, p } (end)}
      {@const tag = device.interfaces[cable[end].iface]?.color}
      <circle
        class="led"
        class:up={status.up}
        cx={p.x}
        cy={p.y}
        r="4.5"
        style:stroke={tag ? TAG_HEX[tag] : undefined}
        style:stroke-width={tag ? 3.5 : undefined}
      >
        <title>{status.up ? t('link.up') : t(`link.down.${status.reason ?? 'unknown'}`)}</title>
      </circle>
    {/each}
  {/if}
  {#if blocked}
    <text class="blocked-label" x={(a.position.x + b.position.x) / 2} y={(a.position.y + b.position.y) / 2 + 14}>{t('switch.blockedCable')}</text>
  {/if}
  {#if geometry.labels}
    <text class="port" x={geometry.labels.a.x} y={geometry.labels.a.y}>{labelA}</text>
    <text class="port" x={geometry.labels.b.x} y={geometry.labels.b.y}>{labelB}</text>
  {/if}
  {#if cable.loss}
    <text class="loss" x={(a.position.x + b.position.x) / 2} y={(a.position.y + b.position.y) / 2 - 8}>⚡ {cable.loss} %</text>
  {/if}
</g>

<style>
  .cable {
    cursor: pointer;
    outline: none;
  }
  .hit {
    stroke: transparent;
    stroke-width: 14;
  }
  .wire {
    stroke: var(--cable);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  /* Beschädigtes Kabel: gestrichelt und in Warnfarbe, damit es bei der Fehlersuche auffallen kann. */
  .wire.damaged {
    stroke: var(--danger);
    stroke-dasharray: 8 5;
  }
  /* Von Spanning Tree blockiert: blass und fein gepunktet. */
  .wire.blocked {
    opacity: 0.45;
    stroke-dasharray: 2 6;
  }
  .blocked-label {
    font-size: 11px;
    text-anchor: middle;
    fill: var(--muted);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    pointer-events: none;
  }
  .loss {
    font-size: 11px;
    font-weight: 600;
    text-anchor: middle;
    fill: var(--danger);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .medium-fiber .wire {
    stroke: var(--fiber, #ef6c00);
    stroke-width: 3.5;
  }
  .medium-wireless .wire {
    stroke: var(--wireless, #2563eb);
    stroke-width: 2;
    stroke-dasharray: 1 7;
    stroke-linecap: round;
  }
  .down .wire {
    opacity: 0.5;
  }
  .faded {
    opacity: 0.15;
  }
  .wifi-badge circle:not(.dotc) {
    fill: var(--surface);
    stroke: var(--wireless, #2563eb);
    stroke-width: 1.5;
  }
  .wifi-badge path {
    fill: none;
    stroke: var(--wireless, #2563eb);
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .wifi-badge .dotc {
    fill: var(--wireless, #2563eb);
  }
  .wifi-badge text {
    font-size: 10px;
    text-anchor: middle;
    fill: var(--muted);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 3px;
  }
  .led {
    fill: var(--led-down, #dc2626);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .led.up {
    fill: var(--led-up, #16a34a);
  }
  .cable:hover .wire {
    stroke-width: 3.5;
  }
  .selected .wire {
    stroke: var(--accent);
    stroke-width: 4;
  }
  .cable:focus-visible .hit {
    stroke: var(--focus-soft);
  }
  .port {
    font-size: 11px;
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--muted);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    user-select: none;
    pointer-events: none;
  }
</style>
