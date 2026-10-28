<script lang="ts">
  import { cableAt, getDevice, linkStatus, mediumOf, type Cable, type Medium } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';

  /** Eigenschaften eines Kabels: an welchem Anschluss es steckt, umstecken, löschen. */
  let { cable }: { cable: Cable } = $props();

  // Feste Stufen statt freier Eingabe: einfacher am Beamer, und eigene Werte erlauben die Projektdatei.
  const LOSS_LEVELS = $derived([...new Set([0, 10, 25, 50, 75, 100, cable.loss ?? 0])].sort((a, b) => a - b));

  const status = $derived(linkStatus(editor.topology, cable));
  const medium = $derived(mediumOf(cable));
  const MEDIA: Medium[] = ['tp', 'fiber', 'wireless'];

  const ends = $derived(
    (['a', 'b'] as const).flatMap((end) => {
      const device = getDevice(editor.topology, cable[end].device);
      if (!device) return [];
      // Wählbar sind der aktuelle und alle freien Anschlüsse desselben Geräts.
      const options = device.interfaces.filter(
        (i) =>
          (i.index === cable[end].iface || !cableAt(editor.topology, { device: device.id, iface: i.index })) &&
          // Access Point: Funk nur auf Funkplätzen, Kabel nur an der LAN-Buchse.
          (device.type !== 'accesspoint' || (i.index > 0) === (medium === 'wireless')),
      );
      return [{ end, device, options }];
    }),
  );
</script>

<dl class="facts">
  <dt>{t('inspector.type')}</dt>
  <dd>{t(`medium.${medium}`)}</dd>
  <dt>{t('link.status')}</dt>
  <dd>
    <span class="led" class:up={status.up}></span>
    {status.up ? t('link.up') : t(`link.down.${status.reason ?? 'unknown'}`)}
    {#if status.signal !== undefined}· {t('link.signal', { n: status.signal })}{/if}
  </dd>
</dl>

<label class="end">
  <span>{t('cable.medium')}</span>
  <select value={medium} disabled={!editor.editable} onchange={(e) => editor.setCableMedium(cable.id, e.currentTarget.value as Medium)}>
    {#each MEDIA as m (m)}
      <option value={m}>{t(`medium.${m}`)}</option>
    {/each}
  </select>
</label>

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

<h3>{t('cable.condition')}</h3>
<label class="end">
  <span>{t('cable.loss')}</span>
  <select
    value={cable.loss ?? 0}
    disabled={!editor.editable}
    onchange={(e) => editor.setCableLoss(cable.id, Number(e.currentTarget.value))}
  >
    {#each LOSS_LEVELS as level (level)}
      <option value={level}>{level === 0 ? t('cable.intact') : t('cable.lossLevel', { n: level })}</option>
    {/each}
  </select>
</label>
<p class="muted">{t('cable.lossHint')}</p>

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
  .led {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #dc2626;
    vertical-align: -1px;
  }
  .led.up {
    background: #16a34a;
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
