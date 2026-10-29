<script lang="ts">
  import { command, keyLabel, type MenuEntry } from '../commands.svelte';
  import Icon from './Icon.svelte';
  import MenuList from './MenuList.svelte';

  /** Einträge eines Menüs (rekursiv für Untermenüs). */
  let { entries, onpick }: { entries: MenuEntry[]; onpick: () => void } = $props();
  let openSub = $state<number | null>(null);
  let list: HTMLElement;

  function visible(e: MenuEntry): boolean {
    if ('command' in e) return command(e.command)?.visible?.() ?? true;
    if ('submenu' in e) return e.visible?.() ?? true;
    return true;
  }

  const shown = $derived.by(() => {
    const items = entries.filter(visible);
    return items.filter((e, i) => !('separator' in e) || (i > 0 && i < items.length - 1 && !('separator' in items[i - 1]!)));
  });

  function onkeydown(event: KeyboardEvent) {
    const items = [...list.querySelectorAll<HTMLElement>(':scope > li > [role^="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<ul class="list" role="menu" bind:this={list} {onkeydown}>
  {#each shown as entry, i (i)}
    {#if 'separator' in entry}
      <li role="separator"></li>
    {:else if 'submenu' in entry}
      <li role="none" class="has-sub" onpointerenter={() => (openSub = i)} onpointerleave={() => (openSub = null)}>
        <button
          role="menuitem"
          class="submenu-trigger"
          aria-haspopup="true"
          aria-expanded={openSub === i}
          onclick={() => (openSub = openSub === i ? null : i)}
          onkeydown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'Enter') {
              openSub = i;
              queueMicrotask(() => (e.currentTarget as HTMLElement | null)?.parentElement?.querySelector<HTMLElement>('.submenu [role^="menuitem"]')?.focus());
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <span class="check"></span>
          <span class="label">{entry.submenu()}</span>
          <Icon name="chevron" size={14} />
        </button>
        {#if openSub === i}
          <div
            class="submenu"
            role="none"
            onkeydown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                openSub = null;
                e.stopPropagation();
                (list.querySelectorAll<HTMLElement>(':scope > li > [role^="menuitem"]')[0] as HTMLElement | undefined)?.focus();
              }
            }}
          >
            <MenuList entries={entry.entries()} {onpick} />
          </div>
        {/if}
      </li>
    {:else}
      {@const c = command(entry.command)}
      {#if c}
        {@const disabled = c.enabled ? !c.enabled() : false}
        {@const checked = c.checked?.()}
        <li role="none">
          <button
            role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked === undefined ? undefined : checked}
            aria-disabled={disabled}
            class:disabled
            onclick={() => {
              if (disabled) return;
              onpick();
              c.run();
            }}
          >
            <span class="check">{checked ? '✓' : ''}</span>
            <span class="label">{c.label()}</span>
            {#if c.keys?.[0]}<kbd>{keyLabel(c.keys[0])}</kbd>{/if}
          </button>
        </li>
      {/if}
    {/if}
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 5px;
    min-width: 230px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 9px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
  }
  li[role='separator'] {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font-size: 0.85rem;
    text-align: left;
    white-space: nowrap;
  }
  button:hover:not(.disabled),
  button:focus-visible {
    background: var(--accent);
    color: var(--on-accent);
    outline: none;
  }
  .disabled {
    opacity: 0.45;
    cursor: default;
  }
  .check {
    width: 1em;
    text-align: center;
  }
  .label {
    flex: 1;
  }
  kbd {
    font-family: inherit;
    font-size: 0.75rem;
    opacity: 0.7;
    margin-left: 18px;
  }
  .has-sub {
    position: relative;
  }
  .submenu {
    position: absolute;
    left: calc(100% - 4px);
    top: -6px;
  }
</style>
