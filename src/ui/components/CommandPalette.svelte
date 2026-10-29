<script lang="ts">
  import { t } from '../../i18n';
  import { allCommands, keyLabel, type Command } from '../commands.svelte';
  import { SHOP, itemLabel } from '../shop';
  import { shop } from '../state/shop.svelte';
  import { ui } from '../state/ui.svelte';
  import Icon from './Icon.svelte';

  /** Befehlssuche (Strg+K): Befehle und Shop-Artikel per Tastatur finden und ausführen. */
  let { onclose }: { onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let query = $state('');
  let active = $state(0);

  $effect(() => {
    dialog.showModal();
  });

  interface Entry {
    id: string;
    label: string;
    detail: string;
    keys?: string;
    icon?: string;
    run: () => void;
    disabled: boolean;
  }

  const entries = $derived.by((): Entry[] => {
    const commands = allCommands().map(
      (c: Command): Entry => ({ id: c.id, label: c.label(), detail: categoryOf(c.id), keys: c.keys?.[0], icon: c.icon, run: c.run, disabled: c.enabled ? !c.enabled() : false }),
    );
    const items = SHOP.filter((item) => item.features.every((f) => ui.has(f))).map(
      (item): Entry => ({ id: `shop.${item.id}`, label: itemLabel(item), detail: t('menu.insert'), icon: 'plus', run: () => shop.use(item), disabled: false }),
    );
    const all = [...commands, ...items];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? all.filter((e) => words.every((w) => `${e.label} ${e.detail}`.toLowerCase().includes(w))).slice(0, 30) : all.slice(0, 30);
  });

  $effect(() => {
    void query;
    active = 0;
  });

  /**
   * Der Befehl läuft erst, wenn die Suche geschlossen ist: Das close-Ereignis
   * kommt verzögert und würde sonst einen eben geöffneten Dialog wieder schliessen.
   */
  let pending: Entry | null = null;
  function choose(entry: Entry | undefined) {
    if (!entry || entry.disabled) return;
    pending = entry;
    dialog.close();
  }

  function closed() {
    const entry = pending;
    pending = null;
    onclose();
    entry?.run();
  }

  /** Kategorie eines Befehls, wie in der Menüleiste. */
  const MENU_OF: Record<string, string> = { file: 'menu.file', edit: 'menu.edit', view: 'menu.view', sim: 'menu.simulation', tool: 'menu.tools', help: 'menu.help', insert: 'menu.insert' };
  const categoryOf = (id: string) => t(MENU_OF[id.split('.')[0]!] ?? 'menu.tools');

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') active = Math.min(entries.length - 1, active + 1);
    else if (event.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (event.key === 'Enter') choose(entries[active]);
    else return;
    event.preventDefault();
  }
</script>

<dialog bind:this={dialog} onclose={closed} aria-label={t('menu.help.palette')} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="search">
    <Icon name="search" />
    <input bind:value={query} placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')} {onkeydown} aria-controls="palette-list" aria-activedescendant="palette-{active}" />
  </div>
  <ul id="palette-list" role="listbox">
    {#each entries as entry, i (entry.id)}
      <li id="palette-{i}" role="option" aria-selected={i === active} aria-disabled={entry.disabled} class:active={i === active} onpointerenter={() => (active = i)}>
        <button onclick={() => choose(entry)} disabled={entry.disabled}>
          <span class="ico">{#if entry.icon}<Icon name={entry.icon} size={16} />{/if}</span>
          <span class="label">{entry.label}</span>
          <span class="detail">{entry.detail}</span>
          {#if entry.keys}<kbd>{keyLabel(entry.keys)}</kbd>{/if}
        </button>
      </li>
    {:else}
      <li class="empty">{t('palette.none')}</li>
    {/each}
  </ul>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    margin-top: 12vh;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.3);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  input {
    flex: 1;
    border: none;
    background: none;
    font: inherit;
    font-size: 1rem;
    color: var(--text);
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: 50vh;
    overflow-y: auto;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--text);
    text-align: left;
  }
  .active button {
    background: var(--selected-soft);
  }
  .ico {
    width: 18px;
    color: var(--muted);
  }
  .label {
    flex: 1;
  }
  .detail {
    font-size: 0.75rem;
    color: var(--muted);
  }
  kbd {
    font-family: inherit;
    font-size: 0.72rem;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
  }
  .empty {
    padding: 14px;
    color: var(--muted);
  }
</style>
