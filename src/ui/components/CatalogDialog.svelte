<script lang="ts">
  import { t } from '../../i18n';
  import { CATALOG, type CatalogEntry } from '../catalog';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';
  import Stars from './Stars.svelte';

  /** Aufgaben-Katalog: vorbereitete Aufgaben mit 1 bis 5 Sternen. */
  let { onclose }: { onclose: () => void } = $props();

  // Texte erst beim Öffnen erzeugen (aktuelle Sprache).
  const entries = $derived(CATALOG.map((entry) => ({ entry, preview: entry.build() })));

  function start(entry: CatalogEntry) {
    const { topology, tasks } = entry.build();
    editor.setMode('design');
    editor.replace(topology, { undoable: true, tasks, snapshots: [] });
    if (entry.pro) ui.setLevel('pro');
    editor.notify(t('catalog.started', { title: tasks.title }));
    onclose();
  }
</script>

<Modal title={t('catalog.title')} {onclose} width={760}>
  <p class="muted">{t('catalog.intro')}</p>
  <ul>
    {#each entries as { entry, preview } (entry.id)}
      {@const locked = entry.pro && !ui.policy.pro}
      <li>
        <div class="stars"><Stars n={entry.stars} /></div>
        <div class="text">
          <strong>{preview.tasks.title}</strong>
          {#if entry.pro}<span class="badge">{t('catalog.pro')}</span>{/if}
          <p class="muted">{preview.tasks.description}</p>
          <span class="muted small">{t('catalog.goals', { n: preview.tasks.goals.length })}</span>
        </div>
        <button onclick={() => start(entry)} disabled={locked} title={locked ? t('catalog.proLocked') : undefined}>{t('catalog.start')}</button>
      </li>
    {/each}
  </ul>
</Modal>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
    max-height: 62vh;
    overflow: auto;
  }
  li {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .text p {
    margin: 4px 0;
    font-size: 0.82rem;
  }
  .small {
    font-size: 0.75rem;
  }
  .badge {
    margin-left: 6px;
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--text);
    color: var(--surface);
  }
</style>
