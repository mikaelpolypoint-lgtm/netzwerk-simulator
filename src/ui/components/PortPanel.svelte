<script lang="ts">
  import { cableAt, getDevice, linkStatus, otherEnd, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { TAG_HEX } from '../tags';

  /**
   * Frontansicht eines Switches: Ports wie auf dem Gerät, mit LED und Farbtag.
   * Umverkabeln: belegten Port anklicken, dann einen freien – das Kabel wird
   * umgesteckt (im Entwurfsmodus).
   */
  let { device }: { device: Device } = $props();

  let moving = $state<number | null>(null);

  // Bei anderem Gerät die Auswahl vergessen.
  $effect(() => {
    void device.id;
    moving = null;
  });

  const ports = $derived(
    device.interfaces.map((iface) => {
      const cable = cableAt(editor.topology, { device: device.id, iface: iface.index });
      const status = cable ? linkStatus(editor.topology, cable) : null;
      const end = cable ? otherEnd(cable, device.id) : null;
      const peer = end ? getDevice(editor.topology, end.device) : undefined;
      return { iface, cable, status, peer: peer?.name ?? '' };
    }),
  );
  // Zwei Reihen wie bei echten Switches: ungerade oben, gerade unten.
  const columns = $derived(Math.ceil(device.interfaces.filter((i) => !i.sfpSlot).length / 2) + device.interfaces.filter((i) => i.sfpSlot).length);

  const copperColumns = $derived(Math.ceil(device.interfaces.filter((i) => !i.sfpSlot).length / 2));
  const sfpIndex = (i: number) => device.interfaces.slice(0, i).filter((x) => x.sfpSlot).length;

  function click(index: number) {
    if (!editor.editable) return;
    const port = ports[index];
    if (!port) return;
    if (moving === null) {
      if (port.cable) moving = index;
      return;
    }
    if (moving === index) {
      moving = null;
      return;
    }
    const from = ports[moving];
    // Glasfaser nur in SFP-Einschübe, Kupfer nur in RJ45-Buchsen.
    if (from && !!from.iface.sfpSlot !== !!port.iface.sfpSlot) return;
    if (from?.cable && !port.cable) {
      const end = from.cable.a.device === device.id && from.cable.a.iface === moving ? 'a' : 'b';
      editor.replugCable(from.cable.id, end, index);
      moving = null;
    } else if (port.cable) {
      moving = index;
    }
  }

  function title(p: (typeof ports)[number]): string {
    const name = interfaceLabel(device, p.iface.index);
    if (!p.cable) return `${name}: ${t('inspector.free')}`;
    const state = p.status?.up ? t('link.up') : t(`link.down.${p.status?.reason ?? 'unknown'}`);
    return `${name} → ${p.peer} (${state})`;
  }
</script>

<div class="panel" style:--cols={columns} role="group" aria-label={t('panel.label', { name: device.name })}>
  {#each ports as p, i (p.iface.index)}
    <button
      class="port"
      class:used={!!p.cable}
      class:moving={moving === i}
      class:target={moving !== null && !p.cable && !!ports[moving]?.iface.sfpSlot === !!p.iface.sfpSlot}
      style:grid-column={p.iface.sfpSlot ? copperColumns + sfpIndex(i) + 1 : Math.floor(i / 2) + 1}
      style:grid-row={p.iface.sfpSlot ? '1 / span 2' : (i % 2) + 1}
      title={title(p)}
      aria-label={title(p)}
      aria-pressed={moving === i}
      disabled={!editor.editable && !p.cable}
      onclick={() => click(i)}
    >
      <span class="led" class:up={p.status?.up} class:down={p.status && !p.status.up}></span>
      {#if p.iface.sfpSlot}
        <span class="cage" class:filled={!!p.iface.sfp} style:border-color={p.iface.color ? TAG_HEX[p.iface.color] : undefined}></span>
        <span class="num">{p.iface.sfp ?? 'SFP'}</span>
      {:else}
        <span class="jack" style:border-color={p.iface.color ? TAG_HEX[p.iface.color] : undefined}></span>
        <span class="num">{i + 1}</span>
      {/if}
    </button>
  {/each}
</div>
<p class="muted">
  {#if !editor.editable}
    {t('panel.hintLocked')}
  {:else if moving !== null}
    {t('panel.hintMoving', { port: interfaceLabel(device, moving) })}
  {:else}
    {t('panel.hint')}
  {/if}
</p>

<style>
  .panel {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 32px));
    justify-content: start;
    gap: 3px;
    padding: 8px;
    border-radius: 6px;
    background: #2b3440;
    max-width: 100%;
    overflow-x: auto;
  }
  .port {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 3px 0 2px;
    min-width: 0;
    background: #1b2129;
    border: 1px solid #3c4756;
    border-radius: 3px;
    color: #b7c2d0;
  }
  .port:hover:not(:disabled) {
    background: #252d38;
  }
  .led {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4b5563;
  }
  .led.up {
    background: #22c55e;
    box-shadow: 0 0 4px #22c55e;
  }
  .led.down {
    background: #ef4444;
  }
  .jack {
    width: 14px;
    height: 11px;
    border: 2px solid #64748b;
    border-radius: 2px 2px 0 0;
    background: #0b0f14;
  }
  .cage {
    width: 18px;
    height: 8px;
    margin: 1px 0;
    border: 2px solid #94a3b8;
    border-radius: 1px;
    background: #0b0f14;
  }
  .cage.filled {
    background: #cbd5e1;
  }
  .used .jack {
    background: #94a3b8;
  }
  .num {
    font-size: 9px;
    line-height: 1;
    white-space: nowrap;
  }
  .moving {
    outline: 2px solid #fbbf24;
    outline-offset: 1px;
  }
  .target {
    border-color: #fbbf24;
    border-style: dashed;
  }
  .muted {
    color: var(--muted);
    font-size: 0.72rem;
    margin: 4px 0 10px;
  }
</style>
