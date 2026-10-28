<script lang="ts">
  import { readTasks, type TaskSet } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /**
   * Für Lehrpersonen: Aufgabe als JSON bearbeiten. Mit "Speichern" in der
   * Werkzeugleiste entsteht daraus eine Aufgabendatei für die Klasse.
   */
  let { onclose }: { onclose: () => void } = $props();

  const template: TaskSet = {
    title: 'Titel der Aufgabe',
    description: 'Was die Lernenden tun sollen.',
    goals: [
      { id: 'kabel', text: 'PC 1 ist mit Switch 1 verkabelt.', check: { type: 'connected', a: 'PC 1', b: 'Switch 1' } },
      { id: 'netz', text: 'PC 1 liegt im Netz 192.168.1.0/24.', check: { type: 'inNetwork', device: 'PC 1', network: '192.168.1.0/24' } },
      { id: 'ping', text: 'PC 1 erreicht PC 2.', check: { type: 'ping', from: 'PC 1', to: 'PC 2' }, hint: 'Stimmen Adressen und Masken?' },
    ],
  };

  let text = $state(JSON.stringify(editor.tasks ?? template, null, 2));
  let error = $state<string | null>(null);
  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      error = t('error.invalidJson');
      return;
    }
    try {
      editor.setTasks(
        readTasks(data, (path) => {
          throw new Error(path);
        }),
      );
      close();
    } catch (e) {
      error = t('tasks.invalid', { path: (e as Error).message });
    }
  }

  function remove() {
    editor.setTasks(null);
    close();
  }

  function close() {
    dialog.close();
    onclose();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="task-editor-title" onclose={onclose}>
  <h2 id="task-editor-title">{t('tasks.editorTitle')}</h2>
  <p class="muted">{t('tasks.editorHelp')}</p>
  <textarea bind:value={text} spellcheck="false" aria-label={t('tasks.editorTitle')}></textarea>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <div class="actions">
    <button class="primary" onclick={apply}>{t('config.apply')}</button>
    <button onclick={close}>{t('web.cancel')}</button>
    {#if editor.tasks}
      <button class="danger" onclick={remove}>{t('tasks.remove')}</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
  }
  dialog::backdrop {
    background: rgba(15, 23, 42, 0.4);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1rem;
  }
  textarea {
    width: 100%;
    height: 50vh;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 8px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    resize: vertical;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .danger {
    margin-left: auto;
    color: var(--danger);
    border-color: var(--danger);
  }
  .error {
    color: var(--danger);
    margin: 6px 0 0;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0 0 8px;
  }
</style>
