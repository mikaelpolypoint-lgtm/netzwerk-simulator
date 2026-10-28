<script lang="ts">
  import { cableAt, getDevice, type Cable } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';

  /** Eigenschaften eines Kabels: an welchem Anschluss es steckt, umstecken, löschen. */
  let { cable }: { cable: Cable } = $props();

  const ends = $derived(
    (['a', 'b'] as const).flatMap((end) => {
      const device = getDevice(editor.topology, cable[end].device);
      if (!device) return [];
      // Wählbar sind der aktuelle und alle freien Anschlüsse desselben Geräts.
      const options = device.interfaces.filter(
        (i) => i.index === cable[end].iface || !cableAt(editor.topology, { device: device.id, iface: i.index }),
      );
      return [{ end, device, options }];
    }),
  );
</script>

<dl class="facts">
  <dt>{t('inspector.type')}</dt>
  <dd>{t('inspector.cable')}</dd>
</dl>

<h3>{t('inspector.endpoints')}</h3>
{#each ends as { end, device, options } (end)}
  <label class="end">
    <span>{device.name}</span>
    <select
      value={cable[end].iface}
      disabled={!editor.editable || options.length < 2}
      onchange={(e) => editor.replugCable(cable.id, end, Number(e.currentTarget.value))}
      aria-label={t('cable.portOf', { device: device.name })}
    >
      {#each options as iface (iface.index)}
        <option value={iface.index}>{interfaceLabel(device, iface.index)}</option>
      {/each}
    </select>
  </label>
{/each}
{#if editor.editable}
  <p class="muted">{t('cable.replugHint')}</p>
{/if}

{#if editor.editable}
  <button class="danger" onclick={() => editor.deleteSelection()}>{t('inspector.delete')}</button>
{/if}

<style>
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
  h3 {
    margin: 12px 0 6px;
    font-size: 0.85rem;
  }
  .end {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 0.85rem;
  }
  select {
    font: inherit;
    padding: 3px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .muted {
    margin: 0 0 8px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .danger {
    margin-top: 12px;
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
