<script lang="ts">
  import { t } from '../../i18n';
  import { MENUS, allCommands, keyLabel } from '../commands.svelte';
  import Modal from './Modal.svelte';

  /** Übersicht aller Tastenkürzel, nach Menü gruppiert. */
  let { onclose }: { onclose: () => void } = $props();
  const groups = $derived(
    MENUS.map((menu) => ({
      label: menu.label(),
      commands: allCommands().filter((c) => c.keys?.length && c.id.startsWith(`${menu.id === 'simulation' ? 'sim' : menu.id === 'tools' ? 'tool' : menu.id}.`)),
    })).filter((g) => g.commands.length),
  );
  const extra: [string, string][] = [
    ['← ↑ → ↓', 'shortcut.move'],
    ['Shift + ← ↑ → ↓', 'shortcut.moveFar'],
    ['Esc', 'shortcut.cancel'],
  ];
</script>

<Modal title={t('menu.help.shortcuts')} {onclose} width={720}>
  <div class="cols">
    {#each groups as group (group.label)}
      <section>
        <h3>{group.label}</h3>
        <dl>
          {#each group.commands as c (c.id)}
            <dt>{#each c.keys ?? [] as k, i (k)}{#if i > 0}<span class="or"> / </span>{/if}<kbd>{keyLabel(k)}</kbd>{/each}</dt>
            <dd>{c.label()}</dd>
          {/each}
        </dl>
      </section>
    {/each}
    <section>
      <h3>{t('shortcut.canvas')}</h3>
      <dl>
        {#each extra as [keys, label] (label)}
          <dt><kbd>{keys}</kbd></dt>
          <dd>{t(label)}</dd>
        {/each}
      </dl>
    </section>
  </div>
  <p class="muted">{t('shortcut.note')}</p>
</Modal>

<style>
  .cols {
    columns: 2 300px;
    column-gap: 28px;
  }
  section {
    break-inside: avoid;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 10px;
    font-size: 0.85rem;
  }
  dd {
    margin: 0;
  }
  kbd {
    font-family: inherit;
    font-size: 0.78rem;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    white-space: nowrap;
  }
  .or {
    color: var(--muted);
  }
</style>
