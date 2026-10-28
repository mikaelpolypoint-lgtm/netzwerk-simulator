<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../i18n';

  /** Gemeinsamer Rahmen für Dialoge: Titel, Inhalt, Schliessen-Knopf. */
  let {
    title,
    onclose,
    width = 620,
    children,
    actions,
  }: { title: string; onclose: () => void; width?: number; children: Snippet; actions?: Snippet } = $props();

  let dialog: HTMLDialogElement;
  const id = `modal-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} aria-labelledby={id} {onclose} style:--w="{width}px">
  <h2 {id}>{title}</h2>
  {@render children()}
  <div class="actions">
    {@render actions?.()}
    <button onclick={() => dialog.close()}>{t('about.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(var(--w), calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    padding: 20px 24px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.15rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  dialog :global(.muted) {
    color: var(--muted);
    font-size: 0.85rem;
  }
  dialog :global(.error) {
    color: var(--danger);
    font-size: 0.85rem;
  }
  dialog :global(.ok) {
    color: #16a34a;
    font-size: 0.85rem;
  }
  dialog :global(input:not([type='checkbox']):not([type='radio'])),
  dialog :global(select),
  dialog :global(textarea) {
    font: inherit;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  dialog :global(h3) {
    margin: 16px 0 6px;
    font-size: 0.95rem;
  }
  dialog :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  dialog :global(th),
  dialog :global(td) {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  dialog :global(th) {
    color: var(--muted);
    font-weight: normal;
  }
  dialog :global(.code) {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    letter-spacing: 0.05em;
  }
</style>
