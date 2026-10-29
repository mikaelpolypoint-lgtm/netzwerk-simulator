<script lang="ts">
  import { t } from '../../i18n';
  import { HELP_GROUPS, HELP_TOPICS, parseHelp } from '../help';
  import { dialogs } from '../state/dialogs.svelte';
  import Icon from './Icon.svelte';

  /** Hilfe als Seitenleiste: Thema lesen, verwandte Themen anklicken, suchen. */
  let query = $state('');
  let panel: HTMLElement;

  const topic = $derived(dialogs.help && HELP_TOPICS.includes(dialogs.help) ? dialogs.help : 'overview');
  const blocks = $derived(parseHelp(t(`help.${topic}.body`)));
  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return HELP_TOPICS.filter((id) => `${t(`help.${id}.title`)} ${t(`help.${id}.body`)}`.toLowerCase().includes(q)).slice(0, 12);
  });

  function open(id: string) {
    dialogs.showHelp(id);
    query = '';
    panel?.querySelector('.content')?.scrollTo({ top: 0 });
  }

  $effect(() => {
    void topic;
    panel?.querySelector<HTMLElement>('h2')?.focus();
  });
</script>

<!-- Tastatursteuerung für die enthaltenen Schaltflächen (Pfeiltasten, Escape). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="help" bind:this={panel} aria-labelledby="help-title" onkeydown={(e) => e.key === 'Escape' && dialogs.closeHelp()}>
  <header>
    <Icon name="help" />
    <h2 id="help-title" tabindex="-1">{t('help.title')}</h2>
    <button class="close" onclick={() => dialogs.closeHelp()} aria-label={t('about.close')}><Icon name="close" size={16} /></button>
  </header>
  <div class="search">
    <input bind:value={query} placeholder={t('help.search')} aria-label={t('help.search')} />
    {#if results.length}
      <ul class="results">
        {#each results as id (id)}
          <li><button onclick={() => open(id)}>{t(`help.${id}.title`)}</button></li>
        {/each}
      </ul>
    {/if}
  </div>
  <div class="content">
    <h3>{t(`help.${topic}.title`)}</h3>
    {#each blocks as block, i (i)}
      {#if block.kind === 'p'}
        <p>{@render parts(block.parts)}</p>
      {:else}
        <ul>
          {#each block.items as item, j (j)}<li>{@render parts(item)}</li>{/each}
        </ul>
      {/if}
    {/each}
    <details class="topics">
      <summary>{t('help.allTopics')}</summary>
      {#each HELP_GROUPS as group (group.id)}
        <h4>{t(`help.group.${group.id}`)}</h4>
        <ul class="list">
          {#each group.topics as id (id)}
            <li><button class:current={id === topic} onclick={() => open(id)}>{t(`help.${id}.title`)}</button></li>
          {/each}
        </ul>
      {/each}
    </details>
  </div>
</aside>

{#snippet parts(list: import('../help').HelpPart[])}
  {#each list as part, k (k)}
    {#if part.kind === 'text'}{part.text}{:else if part.kind === 'bold'}<strong>{part.text}</strong>{:else if part.kind === 'code'}<code>{part.text}</code>{:else}<button class="link" onclick={() => open(part.topic)}>{t(`help.${part.topic}.title`)}</button>{/if}
  {/each}
{/snippet}

<style>
  .help {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100vw);
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -10px 0 30px rgb(0 0 0 / 0.15);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--accent);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1rem;
    color: var(--text);
    outline: none;
  }
  .close {
    border: none;
    background: none;
    color: var(--muted);
  }
  .search {
    padding: 8px 14px;
    position: relative;
  }
  .search input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--text);
  }
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .results button,
  .list button {
    border: none;
    background: none;
    padding: 3px 6px;
    text-align: left;
    width: 100%;
    color: var(--text);
    border-radius: 5px;
  }
  .results button:hover,
  .list button:hover {
    background: var(--selected-soft);
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 18px 18px;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  h3 {
    font-size: 1.1rem;
    margin: 8px 0;
  }
  h4 {
    margin: 10px 0 2px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.85em;
    padding: 0 3px;
    background: var(--surface-2);
    border-radius: 3px;
  }
  .link {
    display: inline;
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    font: inherit;
  }
  .topics {
    margin-top: 20px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .topics summary {
    cursor: pointer;
    font-weight: 600;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .current {
    font-weight: 700;
    color: var(--accent) !important;
  }
</style>
