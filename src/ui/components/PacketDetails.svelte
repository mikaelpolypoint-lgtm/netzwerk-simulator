<script lang="ts">
  import type { PacketLogEntry } from '../../core';
  import { t } from '../../i18n';
  import { layersOf } from '../packets';

  let { entry, onclose }: { entry: PacketLogEntry; onclose: () => void } = $props();

  const layers = $derived(layersOf(entry.frame));
</script>

<section class="details" aria-labelledby="details-title">
  <header>
    <h3 id="details-title">{t('layer.title', { id: entry.id })}</h3>
    <button class="small" onclick={onclose} aria-label={t('layer.close')}>✕</button>
  </header>
  <!-- Jede Schicht steckt in der vorigen: aussen Ethernet, innen die Anwendungsdaten. -->
  {#each layers as layer, depth (layer.title)}
    <details open style="--depth: {depth}">
      <summary>{layer.title}</summary>
      {#if layer.fields.length}
        <dl>
          {#each layer.fields as [label, value], i (i)}
            <dt>{label}</dt>
            <dd>{value}</dd>
          {/each}
        </dl>
      {/if}
      {#if layer.text !== undefined}
        <!-- Zeilenumbrüche sichtbar machen: HTTP trennt Kopfzeilen mit CR LF. -->
        <pre>{layer.text.replace(/\r\n/g, '↵\n')}</pre>
      {/if}
      {#if layer.note}
        <p class="note">{layer.note}</p>
      {/if}
    </details>
  {/each}
</section>

<style>
  .details {
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
    justify-content: space-between;
    margin-bottom: 6px;
  }
  h3 {
    margin: 0;
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.75rem;
    padding: 2px 8px;
  }
  details {
    margin: 0 0 6px calc(var(--depth) * 10px);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    background: var(--surface);
  }
  summary {
    cursor: pointer;
    padding: 4px 8px;
    font-weight: 600;
    background: var(--surface-2);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 6px 8px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 6px 8px;
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
    margin: 0 8px 6px;
    font-size: 0.75rem;
    color: var(--muted);
    font-style: italic;
  }
</style>
