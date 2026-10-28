<script lang="ts">
  import { evaluateTasks, type GoalResult } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import ReviewDialog from './ReviewDialog.svelte';
  import TaskEditor from './TaskEditor.svelte';

  /** Aufgabe mit Lernzielen; "Prüfen" wertet das aktuelle Netz automatisch aus. */
  let results = $state<GoalResult[] | null>(null);
  let editing = $state(false);
  let checking = $state(false);
  let reviewing = $state(false);

  const tasks = $derived(editor.tasks);
  const passedCount = $derived(results?.filter((r) => r.passed).length ?? 0);

  // Neue Aufgabe oder anderes Netz: alte Ergebnisse gelten nicht mehr.
  $effect(() => {
    void editor.tasks;
    void editor.generation;
    results = null;
  });

  function check() {
    if (!tasks) return;
    checking = true;
    // Kurz warten, damit die Oberfläche "prüft …" zeigen kann; die Prüf-Simulationen laufen synchron.
    setTimeout(() => {
      results = evaluateTasks(editor.topology, tasks, simStore.sim?.getPacketLog() ?? []);
      checking = false;
    }, 20);
  }

  const resultOf = (id: string) => results?.find((r) => r.id === id);
</script>

<section class="tasks" aria-labelledby="tasks-title">
  <div class="head">
    <h2 id="tasks-title">{t('tasks.title')}</h2>
    <button class="small" onclick={() => (editing = true)} disabled={!editor.editable} title={t('tasks.editHint')}>
      {tasks ? t('tasks.edit') : t('tasks.create')}
    </button>
  </div>

  {#if !tasks}
    <p class="muted">{t('tasks.none')}</p>
  {:else}
    <h3>{tasks.title}</h3>
    {#if tasks.description}
      <p class="description">{tasks.description}</p>
    {/if}
    <ol class="goals">
      {#each tasks.goals as goal (goal.id)}
        {@const result = resultOf(goal.id)}
        <li class:passed={result?.passed} class:failed={result && !result.passed}>
          <span class="mark" aria-hidden="true">{result ? (result.passed ? '✓' : '✗') : '○'}</span>
          <span>
            {goal.text}
            {#if result}
              <span class="visually-hidden">{t(result.passed ? 'tasks.passed' : 'tasks.failed')}</span>
            {/if}
            {#if result && !result.passed}
              {#if result.reason}
                <span class="reason">{t(`tasks.reason.${result.reason.code}`, result.reason.params)}</span>
              {/if}
              {#if goal.hint}
                <span class="hint">💡 {goal.hint}</span>
              {/if}
            {/if}
          </span>
        </li>
      {/each}
    </ol>
    <button class="check" onclick={check} disabled={checking}>{checking ? t('tasks.checking') : t('tasks.check')}</button>
    {#if results}
      <p class="summary" role="status">{t('tasks.summary', { passed: passedCount, total: tasks.goals.length })}</p>
    {/if}
  {/if}
  <button class="small review" onclick={() => (reviewing = true)} title={t('review.openHint')}>{t('review.open')}</button>
</section>

{#if editing}
  <TaskEditor onclose={() => (editing = false)} />
{/if}
{#if reviewing}
  <ReviewDialog onclose={() => (reviewing = false)} />
{/if}

<style>
  .tasks {
    padding: 12px;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 0.95rem;
  }
  h3 {
    margin: 8px 0 4px;
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.7rem;
    padding: 2px 6px;
  }
  .description {
    margin: 0 0 8px;
  }
  .goals {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .goals li {
    display: grid;
    grid-template-columns: 1.2em 1fr;
    gap: 4px;
  }
  .mark {
    font-weight: 700;
    color: var(--muted);
  }
  .passed .mark {
    color: var(--distribution);
  }
  .failed .mark {
    color: var(--danger);
  }
  .reason,
  .hint {
    display: block;
    margin-top: 2px;
    color: var(--muted);
  }
  .check {
    width: 100%;
    font-weight: 600;
  }
  .review {
    margin-top: 10px;
  }
  .summary {
    margin: 6px 0 0;
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0 0;
  }
</style>
