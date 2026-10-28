<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Entwurfsmodus, Rechner: Webserver mit editierbaren HTML-Seiten. */
  let { device }: { device: Device } = $props();

  const files = $derived(device.webServer?.files ?? []);
  /** Pfad der Seite im Editor; "" = neue Seite. */
  let editing = $state<string | null>(null);
  let path = $state('');
  let content = $state('');
  let error = $state<string | null>(null);

  function toggle(enabled: boolean) {
    const initial = [{ path: '/index.html', content: t('web.defaultPage', { name: device.name }) }];
    editor.setWebServerEnabled(device.id, enabled, initial);
    editing = null;
  }

  function edit(filePath: string | null) {
    const file = files.find((f) => f.path === filePath);
    editing = filePath ?? '';
    path = file?.path ?? '/seite.html';
    content = file?.content ?? t('web.newPage');
    error = null;
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.saveWebFile(device.id, { path, content }, editing || undefined);
    error = failure ? t(`error.${failure.code}`, failure.params) : null;
    if (!failure) editing = null;
  }

  function remove() {
    if (editing) editor.removeWebFile(device.id, editing);
    editing = null;
  }
</script>

<label class="toggle">
  <input type="checkbox" checked={!!device.webServer} onchange={(e) => toggle(e.currentTarget.checked)} />
  {t('web.enable')}
</label>

{#if device.webServer}
  <ul class="files">
    {#each files as file (file.path)}
      <li>
        <button class="link" onclick={() => edit(file.path)} aria-pressed={editing === file.path}>{file.path}</button>
        <span class="muted">{t('web.size', { n: file.content.length })}</span>
      </li>
    {/each}
  </ul>
  {#if editing === null}
    <button onclick={() => edit(null)}>{t('web.newFile')}</button>
  {:else}
    <form class="editor" onsubmit={save}>
      <label>
        <span>{t('web.path')}</span>
        <input bind:value={path} autocomplete="off" spellcheck="false" aria-invalid={!!error} />
      </label>
      <label>
        <span>{t('web.content')}</span>
        <textarea bind:value={content} rows="8" spellcheck="false"></textarea>
      </label>
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <div class="actions">
        <button type="submit">{t('web.save')}</button>
        <button type="button" onclick={() => (editing = null)}>{t('web.cancel')}</button>
        {#if editing}
          <button type="button" class="danger" onclick={remove}>{t('inspector.delete')}</button>
        {/if}
      </div>
    </form>
  {/if}
  <p class="muted">{t('web.explain', { name: device.name })}</p>
{/if}

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  .files {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }
  .files li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
  }
  .link {
    border: none;
    background: none;
    padding: 2px 0;
    color: var(--accent);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    text-decoration: underline;
  }
  .link[aria-pressed='true'] {
    font-weight: 700;
  }
  .editor {
    display: grid;
    gap: 6px;
  }
  .editor label {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
  }
  input,
  textarea {
    width: 100%;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  textarea {
    resize: vertical;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .danger {
    margin-left: auto;
    color: var(--danger);
    border-color: var(--danger);
  }
  .error {
    margin: 0;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .muted {
    margin: 6px 0 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
