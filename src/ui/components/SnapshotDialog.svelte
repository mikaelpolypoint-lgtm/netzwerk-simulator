<script lang="ts">
  import { locale, t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /**
   * Snapshots: benannte Zwischenstände der Topologie. Sie werden mit dem
   * Projekt gespeichert, damit man Arbeitsschritte nachvollziehen und zu
   * einem früheren Stand zurückkehren kann.
   */
  let { onclose }: { onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  let name = $state('');

  $effect(() => {
    dialog.showModal();
  });

  const list = $derived([...editor.snapshots].reverse());

  function create(event: SubmitEvent) {
    event.preventDefault();
    editor.createSnapshot(name || t('snapshot.defaultName', { n: editor.snapshots.length + 1 }));
    name = '';
  }

  function restore(id: string) {
    editor.restoreSnapshot(id);
    dialog.close();
  }

  function stats(s: (typeof editor.snapshots)[number]) {
    return t('snapshot.stats', { devices: s.topology.devices.length, cables: s.topology.cables.length });
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale() === 'fr' ? 'fr-CH' : 'de-CH', { dateStyle: 'short', timeStyle: 'short' });
</script>

<dialog bind:this={dialog} aria-labelledby="snapshot-title" onclose={onclose}>
  <h2 id="snapshot-title">{t('snapshot.title')}</h2>
  <p class="muted">{t('snapshot.help')}</p>

  <form onsubmit={create}>
    <input bind:value={name} maxlength="80" placeholder={t('snapshot.namePlaceholder')} aria-label={t('snapshot.name')} />
    <button type="submit">{t('snapshot.create')}</button>
  </form>

  {#if list.length === 0}
    <p class="muted">{t('snapshot.empty')}</p>
  {:else}
    <ol>
      {#each list as s (s.id)}
        <li class:current={s.topology === editor.topology}>
          <div class="meta">
            <input
              class="title"
              value={s.name}
              aria-label={t('snapshot.name')}
              onchange={(e) => editor.renameSnapshot(s.id, e.currentTarget.value)}
            />
            <span class="muted small">
              {when(s.created)} · {stats(s)}{s.auto ? ` · ${t('snapshot.auto')}` : ''}{s.topology === editor.topology ? ` · ${t('snapshot.current')}` : ''}
            </span>
          </div>
          <button disabled={editor.mode === 'action' || s.topology === editor.topology} onclick={() => restore(s.id)}>
            {t('snapshot.restore')}
          </button>
          <button class="delete" aria-label={t('snapshot.delete', { name: s.name })} onclick={() => editor.deleteSnapshot(s.id)}>✕</button>
        </li>
      {/each}
    </ol>
    {#if editor.mode === 'action'}
      <p class="muted small">{t('snapshot.actionHint')}</p>
    {/if}
  {/if}

  <div class="actions">
    <button onclick={() => dialog.close()}>{t('about.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
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
  .muted {
    color: var(--muted);
    margin: 4px 0 12px;
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.75rem;
    margin: 0;
  }
  form {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  input {
    flex: 1;
    font: inherit;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  li.current {
    border-color: var(--accent);
    background: var(--selected-soft);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .title {
    border-color: transparent;
    background: transparent;
    font-weight: 600;
    padding: 2px 4px;
  }
  .title:hover,
  .title:focus {
    border-color: var(--border);
  }
  .delete {
    padding: 4px 8px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
