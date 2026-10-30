<script lang="ts">
  import { t } from '../../i18n';
  import { MENUS, command, keyLabel } from '../commands.svelte';
  import { dialogs } from '../state/dialogs.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import MenuList from './MenuList.svelte';

  /**
   * Menüleiste wie bei macOS: Datei, Bearbeiten, Einfügen, Ansicht,
   * Simulation, Werkzeuge, Hilfe. Ist ein Menü offen, wechselt man mit der
   * Maus oder den Pfeiltasten zum nächsten.
   */
  let open = $state<string | null>(null);
  let bar: HTMLElement;

  function toggle(id: string) {
    open = open === id ? null : id;
  }

  function onwindowpointer(event: PointerEvent) {
    if (open && !bar.contains(event.target as Node)) open = null;
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open) return;
    const index = MENUS.findIndex((m) => m.id === open);
    if (event.key === 'Escape') {
      open = null;
      (bar.querySelector(`[data-menu="${MENUS[index]?.id}"]`) as HTMLElement | null)?.focus();
      event.stopPropagation();
    } else if (event.key === 'ArrowRight' && !(event.target as Element).closest('.submenu-trigger')) {
      open = MENUS[(index + 1) % MENUS.length]!.id;
      queueMicrotask(focusFirst);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && !(event.target as Element).closest('.submenu')) {
      open = MENUS[(index - 1 + MENUS.length) % MENUS.length]!.id;
      queueMicrotask(focusFirst);
      event.preventDefault();
    }
  }

  function focusFirst() {
    (bar.querySelector('.dropdown [role="menuitem"]:not([aria-disabled="true"]), .dropdown [role="menuitemcheckbox"]') as HTMLElement | null)?.focus();
  }

  function titleKeydown(event: KeyboardEvent, id: string) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      open = id;
      queueMicrotask(focusFirst);
      event.preventDefault();
    }
  }

</script>

<svelte:window onpointerdown={onwindowpointer} />

<!-- Tastatursteuerung für die enthaltenen Schaltflächen (Pfeiltasten, Escape). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="menubar" bind:this={bar} aria-label={t('menu.label')} onkeydown={onkeydown}>
  <button class="brand" onclick={() => dialogs.show('about')} title={t('about.open')} aria-label={t('about.open')}>
    <Logo height={26} />
  </button>
  <ul role="menubar">
    {#each MENUS as menu (menu.id)}
      <li role="none" class="menu">
        <button
          role="menuitem"
          data-menu={menu.id}
          aria-haspopup="true"
          aria-expanded={open === menu.id}
          class:open={open === menu.id}
          onclick={() => toggle(menu.id)}
          onpointerenter={() => {
            if (open && open !== menu.id) open = menu.id;
          }}
          onkeydown={(e) => titleKeydown(e, menu.id)}
        >
          {menu.label()}
        </button>
        {#if open === menu.id}
          <div class="dropdown">
            <MenuList entries={menu.entries()} onpick={() => (open = null)} />
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  <span class="spacer"></span>
  <button class="search" onclick={() => command('help.palette')?.run()} title="{t('menu.help.palette')} ({keyLabel('Mod+K')})">
    <Icon name="search" size={15} />
    <span>{t('palette.searchShort')}</span>
    <kbd>{keyLabel('Mod+K')}</kbd>
  </button>
</nav>

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.86rem;
    position: relative;
    z-index: 30;
  }
  .brand {
    all: unset;
    display: flex;
    align-items: center;
    margin: 0 10px 0 2px;
    padding: 2px 4px;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
  }
  .brand:hover,
  .brand:focus-visible {
    background: var(--hover);
  }
  ul {
    display: flex;
    gap: 0;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .menu {
    position: relative;
  }
  .menu > button {
    border: none;
    background: none;
    padding: 4px 9px;
    border-radius: 5px;
    font-size: inherit;
    color: var(--text);
  }
  .menu > button:hover,
  .menu > button.open {
    background: var(--selected-soft);
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
  }
  .spacer {
    flex: 1;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--muted);
    background: var(--surface);
  }
  kbd {
    font-family: inherit;
    font-size: 0.72rem;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  @media (max-width: 900px) {
    .search span {
      display: none;
    }
  }
</style>
