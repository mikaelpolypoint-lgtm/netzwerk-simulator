<script lang="ts">
  import { dissect, mediumOf, type OsiLayer, type PacketLogEntry, type WireField, type WireLayer } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';

  let { entry, onclose }: { entry: PacketLogEntry; onclose: () => void } = $props();

  /**
   * Der Rahmen wird mit echten Bytes kodiert (wie auf der Leitung) und nach dem
   * OSI-Modell gezeigt: oben die Anwendung, unten die Bitübertragung. Ein Klick
   * auf ein Feld markiert seine Bytes in der Hex-Ansicht.
   */
  const medium = $derived.by(() => {
    const cable = editor.topology.cables.find((c) => c.id === entry.cable);
    return cable ? mediumOf(cable) : 'tp';
  });
  const wire = $derived(dissect(entry.frame, medium));
  const OSI: readonly OsiLayer[] = [7, 6, 5, 4, 3, 2, 1];
  const byLayer = $derived(new Map(OSI.map((n) => [n, wire.layers.filter((l) => l.osi === n)])));
  /** Hat der Rahmen überhaupt Anwendungsdaten (Schicht 4 oder höher)? Sonst sind 5 und 6 einfach leer. */
  const hasUpper = $derived(wire.layers.some((l) => l.osi >= 4));

  let marked = $state<{ start: number; length: number } | null>(null);
  $effect(() => {
    void entry.id;
    marked = null;
  });

  /** Feldname übersetzen; ohne Übersetzung bleibt der Filtername (wie in Wireshark). */
  function label(key: string): string {
    const text = t(`field.${key}`);
    return text === `field.${key}` ? key : text;
  }

  function mark(item: WireField | WireLayer) {
    marked = item.length > 0 ? { start: item.start, length: item.length } : null;
  }

  const isMarked = (i: number) => marked !== null && i >= marked.start && i < marked.start + marked.length;
  const hexByte = (b: number) => b.toString(16).padStart(2, '0');
  const ascii = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·');
  const lines = $derived(Array.from({ length: Math.ceil(wire.bytes.length / 16) }, (_, i) => i * 16));
</script>

<section class="details" aria-labelledby="details-title">
  <header>
    <h3 id="details-title">{t('layer.title', { id: entry.id })}</h3>
    <span class="muted">{t('wire.size', { n: wire.bytes.length })}</span>
    <button class="small" onclick={onclose} aria-label={t('layer.close')}>✕</button>
  </header>

  {#if ui.has('tool.osi')}
    <p class="hint">{t('wire.osiHint')}</p>
  {/if}

  {#each OSI as n (n)}
    {@const layers = byLayer.get(n) ?? []}
    {#if ui.has('tool.osi') || layers.length > 0}
      <div class="osi" class:empty={layers.length === 0} style="--osi: var(--osi-{n})">
        <div class="osi-label" title={t(`osi.${n}.tip`)}>
          <strong>{n}</strong>
          <span>{t(`osi.${n}.name`)}</span>
        </div>
        <div class="osi-body">
          {#if layers.length === 0}
            <span class="muted">{t(n >= 5 && n <= 6 && hasUpper ? 'wire.inApplication' : 'wire.emptyLayer')}</span>
          {/if}
          {#each layers as layer, li (li)}
            <details open>
              <summary
                onmouseenter={() => mark(layer)}
                onfocus={() => mark(layer)}
              >
                {layer.protocol}
                {#if layer.length > 0}<span class="muted"> · {t('wire.bytes', { n: layer.length })}</span>{/if}
              </summary>
              {#if layer.fields.length}
                <dl>
                  {#each layer.fields as field, i (i)}
                    <dt>
                      <button
                        class="field"
                        class:on={marked?.start === field.start && marked?.length === field.length}
                        title={field.key}
                        onclick={() => mark(field)}
                        onmouseenter={() => mark(field)}>{label(field.key)}</button
                      >
                    </dt>
                    <dd>{field.value}</dd>
                  {/each}
                </dl>
              {/if}
              {#if layer.text !== undefined}
                <!-- Zeilenumbrüche sichtbar machen: HTTP trennt Kopfzeilen mit CR LF. -->
                <pre>{layer.text.replace(/\r\n/g, '↵\n')}</pre>
              {/if}
              {#if layer.note}
                <p class="note">{t(`wire.${layer.note}`)}</p>
              {/if}
            </details>
          {/each}
        </div>
      </div>
    {/if}
  {/each}

  {#if ui.has('tool.hex') && wire.bytes.length > 0}
    <h4>{t('wire.hex')}</h4>
    <div class="hex" role="group" aria-label={t('wire.hex')}>
      {#each lines as offset (offset)}
        <div class="hex-line">
          <span class="offset">{offset.toString(16).padStart(4, '0')}</span>
          <span class="bytes">
            {#each wire.bytes.slice(offset, offset + 16) as b, i (i)}<span class:hl={isMarked(offset + i)}>{hexByte(b)}</span>{/each}
          </span>
          <span class="ascii">
            {#each wire.bytes.slice(offset, offset + 16) as b, i (i)}<span class:hl={isMarked(offset + i)}>{ascii(b)}</span>{/each}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .details {
    --osi-7: #8e44ad;
    --osi-6: #9b59b6;
    --osi-5: #a569bd;
    --osi-4: #2e86c1;
    --osi-3: #16a085;
    --osi-2: #d68910;
    --osi-1: #7f8c8d;
    height: 100%;
    overflow-y: auto;
    padding: 8px 10px;
    border-left: 1px solid var(--border);
    background: var(--surface);
    font-size: 0.8rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  header .muted {
    flex: 1;
  }
  h3 {
    margin: 0;
    font-size: 0.85rem;
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 0.8rem;
  }
  .hint {
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 0.72rem;
  }
  .small {
    font-size: 0.75rem;
    padding: 2px 8px;
  }
  .osi {
    display: grid;
    grid-template-columns: 96px 1fr;
    margin-bottom: 4px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--osi);
    border-radius: 6px;
    overflow: hidden;
  }
  .osi.empty {
    opacity: 0.55;
    font-size: 0.7rem;
  }
  .osi.empty .osi-label {
    flex-direction: row;
    align-items: baseline;
    gap: 4px;
    padding: 1px 6px;
  }
  .osi.empty .osi-label strong {
    font-size: 0.75rem;
  }
  .osi.empty .osi-body {
    padding: 1px 6px;
  }
  .osi-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    background: var(--surface-2);
    font-size: 0.7rem;
    cursor: help;
  }
  .osi-label strong {
    font-size: 0.9rem;
    color: var(--osi);
  }
  .osi-body {
    padding: 3px 6px;
    min-width: 0;
  }
  details + details {
    border-top: 1px dashed var(--border);
  }
  summary {
    cursor: pointer;
    padding: 2px 0;
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 2px 0 4px;
  }
  dt {
    color: var(--muted);
  }
  .field {
    all: unset;
    cursor: pointer;
    border-radius: 3px;
    padding: 0 2px;
  }
  .field:hover,
  .field:focus-visible,
  .field.on {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text);
  }
  dd {
    margin: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 4px 0;
    padding: 6px;
    max-height: 220px;
    overflow: auto;
    font-size: 0.75rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-2);
    border-radius: 4px;
  }
  .note {
    margin: 0 0 4px;
    font-size: 0.72rem;
    color: var(--muted);
    font-style: italic;
  }
  .hex {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.72rem;
    background: var(--surface-2);
    border-radius: 4px;
    padding: 4px 6px;
    overflow-x: auto;
  }
  .hex-line {
    display: flex;
    gap: 10px;
    white-space: pre;
  }
  .offset {
    color: var(--muted);
  }
  .bytes span {
    margin-right: 0.45em;
  }
  .hl {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 2px;
  }
</style>
