<script lang="ts">
  import { floorsOf, type Device } from '../../core';
  import { t } from '../../i18n';
  import { typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import PortPanel from './PortPanel.svelte';

  /**
   * Rack-Ansicht: alle Netzwerkgeräte als Einschübe in einem 19-Zoll-Schrank,
   * pro Stockwerk ein Rack. Die Frontplatten zeigen Link-LEDs und Farbtags,
   * Kabel lassen sich hier direkt umstecken.
   */
  let { onclose }: { onclose: () => void } = $props();
  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });

  const RACK_TYPES = new Set(['switch', 'l3switch', 'router', 'modem']);
  const floors = $derived(floorsOf(editor.topology));
  const racks = $derived(
    floors
      .map((floor, index) => ({
        name: floor.name || t('rack.single'),
        devices: editor.topology.devices
          .filter((d) => RACK_TYPES.has(d.type) && (d.floor ?? 0) === index)
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
      }))
      .filter((r) => r.devices.length > 0),
  );

  const units = (d: Device) => (d.interfaces.length > 24 ? 2 : 1);
</script>

<dialog bind:this={dialog} aria-labelledby="rack-title" onclose={onclose}>
  <h2 id="rack-title">{t('rack.title')}</h2>
  <p class="muted">{t('rack.help')}</p>

  {#if racks.length === 0}
    <p class="muted">{t('rack.empty')}</p>
  {/if}

  <div class="racks">
    {#each racks as rack (rack.name)}
      <section class="rack" aria-label={t('rack.label', { name: rack.name })}>
        <h3>{rack.name}</h3>
        <div class="frame">
          {#each rack.devices as device, i (device.id)}
            <div class="unit" style:--u={units(device)}>
              <span class="u">{i + 1}</span>
              <div class="label">
                <strong>{device.name}</strong>
                <span>{typeLabel(device.type)}</span>
              </div>
              <div class="front"><PortPanel {device} /></div>
            </div>
          {/each}
          <div class="blank"></div>
        </div>
      </section>
    {/each}
  </div>

  <div class="actions">
    <button onclick={() => dialog.close()}>{t('about.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(980px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    padding: 20px 24px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 0.9rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 4px 0 12px;
  }
  .racks {
    display: grid;
    gap: 18px;
  }
  .frame {
    padding: 10px 18px;
    border-radius: 8px;
    background: repeating-linear-gradient(to bottom, #111827 0 2px, #1f2937 2px 6px);
    border-left: 14px solid #374151;
    border-right: 14px solid #374151;
    display: grid;
    gap: 6px;
  }
  .unit {
    display: grid;
    grid-template-columns: 1.6rem 9rem minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: calc(var(--u) * 54px);
    padding: 4px 8px;
    background: #2b3440;
    border: 1px solid #3c4756;
    border-radius: 4px;
    color: #e6ebf1;
  }
  .u {
    font-size: 0.7rem;
    color: #9ca3af;
    text-align: center;
  }
  .label {
    display: grid;
    font-size: 0.8rem;
    line-height: 1.2;
    min-width: 0;
  }
  .label span {
    color: #9ca3af;
    font-size: 0.7rem;
  }
  .label strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .front :global(.panel) {
    padding: 4px;
  }
  .front :global(p.muted) {
    display: none;
  }
  .blank {
    height: 24px;
    border: 1px dashed #4b5563;
    border-radius: 4px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
