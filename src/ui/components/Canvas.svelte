<script lang="ts">
  import { untrack } from 'svelte';
  import { getDevice, isDeviceType, type Device, type Point } from '../../core';
  import { t } from '../../i18n';
  import { DEVICE_MIME } from '../dnd';
  import { protocolOf } from '../packets';
  import { GRID, editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import CableLine from './CableLine.svelte';
  import DeviceNode from './DeviceNode.svelte';

  let svg: SVGSVGElement;
  let width = $state(0);
  let height = $state(0);
  let pointer = $state<Point | null>(null);
  let panFrom = $state<Point | null>(null);
  /** Abstand Gerätemitte – Mauszeiger beim Greifen, damit das Gerät nicht springt. */
  let drag: { id: string; offset: Point } | null = null;

  // untrack: setCanvasSize liest und verschiebt die Ansicht, das darf diesen Effekt nicht erneut auslösen.
  $effect(() => {
    const size = { width, height };
    untrack(() => editor.setCanvasSize(size.width, size.height));
  });

  // Wheel-Listener müssen aktiv (nicht passiv) sein, damit die Seite nicht scrollt.
  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = local(event);
      editor.zoomAt(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const view = $derived(editor.view);
  const source = $derived(editor.cableSource ? getDevice(editor.topology, editor.cableSource) : undefined);
  const cables = $derived(
    editor.topology.cables.flatMap((cable) => {
      const a = getDevice(editor.topology, cable.a.device);
      const b = getDevice(editor.topology, cable.b.device);
      return a && b ? [{ cable, a, b }] : [];
    }),
  );

  /** Rahmen unterwegs als Punkte, die vom Sender zum Empfänger wandern. */
  const dots = $derived.by(() => {
    void simStore.tick;
    const sim = simStore.sim;
    if (editor.editable || !sim) return [];
    return sim.getInFlight().flatMap((entry) => {
      const from = getDevice(editor.topology, entry.from.device);
      const to = getDevice(editor.topology, entry.to.device);
      if (!from || !to) return [];
      const progress = Math.min(1, Math.max(0, (sim.now - entry.sent) / (entry.arrives - entry.sent)));
      return [
        {
          id: entry.id,
          x: from.position.x + (to.position.x - from.position.x) * progress,
          y: from.position.y + (to.position.y - from.position.y) * progress,
          protocol: protocolOf(entry.frame).toLowerCase(),
        },
      ];
    });
  });

  function local(event: { clientX: number; clientY: number }): Point {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function world(event: { clientX: number; clientY: number }): Point {
    const p = local(event);
    return editor.screenToWorld(p.x, p.y);
  }

  function onDevicePointerDown(event: PointerEvent, device: Device) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (editor.tool === 'cable') {
      editor.cableClick(device.id);
      return;
    }
    editor.select({ kind: 'device', id: device.id });
    if (!editor.editable) return;
    const p = world(event);
    drag = { id: device.id, offset: { x: device.position.x - p.x, y: device.position.y - p.y } };
    editor.beginDrag();
    svg.setPointerCapture(event.pointerId);
  }

  function onBackgroundPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0) {
      if (editor.cableSource) editor.cancel();
      else editor.select(null);
    }
    panFrom = local(event);
    svg.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const p = world(event);
    pointer = p;
    if (drag) {
      editor.dragTo(drag.id, { x: p.x + drag.offset.x, y: p.y + drag.offset.y });
    } else if (panFrom) {
      const now = local(event);
      editor.panBy(now.x - panFrom.x, now.y - panFrom.y);
      panFrom = now;
    }
  }

  function onPointerUp() {
    if (drag) {
      editor.endDrag();
      drag = null;
    }
    panFrom = null;
  }

  function onDragOver(event: DragEvent) {
    if (!editor.editable || !event.dataTransfer?.types.includes(DEVICE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent) {
    const type = event.dataTransfer?.getData(DEVICE_MIME);
    if (!isDeviceType(type)) return;
    event.preventDefault();
    editor.addDevice(type, world(event));
  }
</script>

<div class="canvas" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={svg}
    class:panning={panFrom !== null}
    class:cable-tool={editor.tool === 'cable'}
    role="application"
    aria-label={t('canvas.label')}
    onpointerdown={onBackgroundPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => (pointer = null)}
    ondragover={onDragOver}
    ondrop={onDrop}
  >
    <defs>
      <pattern
        id="grid"
        width={GRID * 2}
        height={GRID * 2}
        patternUnits="userSpaceOnUse"
        patternTransform="translate({view.x} {view.y}) scale({view.scale})"
      >
        <circle class="dot" cx="1" cy="1" r="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />

    <g transform="translate({view.x} {view.y}) scale({view.scale})">
      {#each cables as { cable, a, b } (cable.id)}
        <CableLine {cable} {a} {b} />
      {/each}
      {#if source && pointer}
        <line class="rubber" x1={source.position.x} y1={source.position.y} x2={pointer.x} y2={pointer.y} />
      {/if}
      {#each editor.topology.devices as device (device.id)}
        <DeviceNode {device} onpointerdown={onDevicePointerDown} />
      {/each}
      {#each dots as dot (dot.id)}
        <circle class="dot-packet proto-{dot.protocol}" cx={dot.x} cy={dot.y} r="7" />
      {/each}
    </g>
  </svg>

  {#if editor.topology.devices.length === 0}
    <p class="empty">{t('canvas.empty')}</p>
  {/if}
  {#if editor.tool === 'cable'}
    <p class="hint" role="status">
      {source ? t('canvas.cableTarget', { name: source.name }) : t('canvas.cableStart')}
    </p>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  svg.panning {
    cursor: grabbing;
  }
  svg.cable-tool {
    cursor: crosshair;
  }
  .dot {
    fill: var(--grid);
  }
  .dot-packet {
    fill: var(--dot, var(--accent));
    stroke: var(--bg);
    stroke-width: 2;
    pointer-events: none;
  }
  .rubber {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 5;
    pointer-events: none;
  }
  .empty,
  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    pointer-events: none;
    text-align: center;
  }
  .empty {
    top: 45%;
    color: var(--muted);
    font-size: 1.1rem;
  }
  .hint {
    top: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    max-width: calc(100% - 32px);
  }
</style>
