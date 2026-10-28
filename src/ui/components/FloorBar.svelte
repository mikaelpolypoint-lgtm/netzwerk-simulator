<script lang="ts">
  import { floorsOf } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';

  /**
   * Stockwerke: «Alle» zeigt das ganze Gebäude, ein einzelnes Stockwerk
   * blendet die Geräte der anderen ab. Funk und Mesh werden pro Stockwerk
   * Unterschied gedämpft.
   */
  const floors = $derived(floorsOf(editor.topology));
  const multi = $derived(floors.length > 1);
  let adding = $state(false);
  let draft = $state('');
  let renaming = $state<number | null>(null);

  $effect(() => {
    if (ui.floor !== 'all' && ui.floor >= floors.length) ui.floor = 'all';
  });

  function add(event: SubmitEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    editor.addFloor(name);
    draft = '';
    adding = false;
    ui.floor = floorsOf(editor.topology).length - 1;
  }

  function rename(event: SubmitEvent, index: number) {
    event.preventDefault();
    editor.renameFloor(index, draft);
    renaming = null;
    draft = '';
  }

  const canEdit = $derived(editor.editable || editor.documenting);
</script>

<div class="floors" role="toolbar" aria-label={t('floor.label')}>
  <span class="label">{t('floor.label')}</span>
  {#if multi}
    <button aria-pressed={ui.floor === 'all'} onclick={() => (ui.floor = 'all')}>{t('floor.all')}</button>
    {#each floors as floor, index (index)}
      {#if renaming === index}
        <form onsubmit={(e) => rename(e, index)}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={draft} maxlength="40" autofocus aria-label={t('floor.name')} onblur={() => (renaming = null)} />
        </form>
      {:else}
        <button
          aria-pressed={ui.floor === index}
          onclick={() => (ui.floor = index)}
          ondblclick={() => {
            if (!canEdit) return;
            renaming = index;
            draft = floor.name;
          }}
          title={canEdit ? t('floor.renameHint') : undefined}
        >
          {floor.name}
        </button>
      {/if}
    {/each}
    {#if ui.floor !== 'all' && editor.editable}
      <button class="ghost" onclick={() => editor.removeFloor(ui.floor as number)} title={t('floor.removeHint')} aria-label={t('floor.remove')}>✕</button>
    {/if}
  {:else}
    <span class="muted">{t('floor.single')}</span>
  {/if}
  {#if canEdit}
    {#if adding}
      <form onsubmit={add}>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={draft} maxlength="40" autofocus placeholder={t('floor.newPlaceholder')} aria-label={t('floor.name')} onblur={() => !draft && (adding = false)} />
        <button type="submit">{t('floor.add')}</button>
      </form>
    {:else}
      <button class="ghost" onclick={() => (adding = true)}>+ {t('floor.add')}</button>
    {/if}
  {/if}
</div>

<style>
  .floors {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 10px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .label {
    color: var(--muted);
    margin-right: 4px;
  }
  .muted {
    color: var(--muted);
  }
  button {
    font-size: 0.8rem;
    padding: 2px 10px;
    border-radius: 999px;
  }
  .ghost {
    border-style: dashed;
  }
  form {
    display: flex;
    gap: 4px;
  }
  input {
    font: inherit;
    font-size: 0.8rem;
    padding: 2px 8px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    width: 10em;
  }
</style>
