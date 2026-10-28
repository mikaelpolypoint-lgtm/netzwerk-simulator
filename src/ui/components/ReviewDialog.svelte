<script lang="ts">
  import { reviewCsv, reviewSubmission, type SubmissionReview } from '../../core';
  import { t } from '../../i18n';
  import { errorText } from '../labels';
  import { downloadText } from '../persist/files';
  import { editor } from '../state/editor.svelte';

  /**
   * Für Lehrpersonen: Projektdateien der Klasse auf einmal öffnen und gegen die
   * Aufgabe prüfen. Alles bleibt im Browser; nichts wird hochgeladen.
   */
  let { onclose }: { onclose: () => void } = $props();

  let reviews = $state<SubmissionReview[]>([]);
  let running = $state(0);
  let dialog: HTMLDialogElement;

  // Spalten: geladene Aufgabe, sonst die der ersten lesbaren Datei.
  const columns = $derived(editor.tasks ?? reviews.find((r) => r.ok)?.tasks ?? null);

  $effect(() => {
    dialog.showModal();
  });

  async function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    input.value = '';
    if (files.length === 0) return;
    running = files.length;
    const texts = await Promise.all(files.map((f) => f.text().catch(() => null)));
    // Die Prüf-Simulationen laufen synchron; kurz warten, damit "prüfe …" sichtbar wird.
    setTimeout(() => {
      reviews = files.map((f, i): SubmissionReview => {
        const text = texts[i];
        return text === null ? { ok: false, name: f.name, error: { code: 'readFailed' } } : reviewSubmission(f.name, text, editor.tasks);
      });
      running = 0;
    }, 20);
  }

  function saveCsv() {
    if (!columns) return;
    const csv = reviewCsv(columns, reviews, { file: t('review.file'), score: t('review.score'), error: t('review.error') });
    const slug = columns.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();
    // BOM, damit Excel Umlaute richtig liest.
    downloadText(`auswertung-${slug}.csv`, '﻿' + csv, 'text/csv');
  }

  function close() {
    dialog.close();
    onclose();
  }

  const mark = (review: SubmissionReview, id: string) => (review.ok ? review.marks.find((m) => m.id === id) : undefined);
</script>

<dialog bind:this={dialog} aria-labelledby="review-title" onclose={onclose}>
  <h2 id="review-title">{t('review.title')}</h2>
  <p class="muted">
    {#if editor.tasks}{t('review.helpTask', { title: editor.tasks.title })}{/if}
    {t('review.help')}
  </p>
  <label class="choose">
    <span class="button">{t('review.choose')}</span>
    <input type="file" accept=".json,application/json" multiple onchange={choose} class="visually-hidden" />
  </label>

  {#if running}
    <p role="status">{t('review.running', { n: running })}</p>
  {:else if reviews.length === 0}
    <p class="muted">{t('review.empty')}</p>
  {:else if !columns}
    <p class="error">{t('error.noTasks')}</p>
  {:else}
    <div class="scroller">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('review.file')}</th>
            <th scope="col" class="num">{t('review.score')}</th>
            {#each columns.goals as goal, i (goal.id)}
              <th scope="col" class="goal" title={goal.text}>{i + 1}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each reviews as review, i (i)}
            <tr>
              <th scope="row">
                {review.name}
                {#if review.ok && review.ownTasks && review.tasks.title !== columns.title}
                  <span class="muted">({t('review.ownTasks')})</span>
                {/if}
              </th>
              {#if review.ok}
                <td class="num">{review.passed}/{review.assessable}</td>
                {#each columns.goals as goal (goal.id)}
                  {@const m = mark(review, goal.id)}
                  <td
                    class="goal"
                    class:passed={m?.passed}
                    class:failed={m && !m.skipped && !m.passed}
                    title={m?.skipped
                      ? t('review.skipped')
                      : m && !m.passed && m.reason
                        ? t(`tasks.reason.${m.reason.code}`, m.reason.params)
                        : goal.text}
                  >
                    <span aria-hidden="true">{m?.skipped ? '–' : m?.passed ? '✓' : m ? '✗' : ''}</span>
                    {#if m}
                      <span class="visually-hidden">{m.skipped ? t('review.skipped') : t(m.passed ? 'tasks.passed' : 'tasks.failed')}</span>
                    {/if}
                  </td>
                {/each}
              {:else}
                <td colspan={columns.goals.length + 1} class="error">{errorText(review.error)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <ol class="legend muted">
      {#each columns.goals as goal (goal.id)}
        <li>{goal.text}</li>
      {/each}
    </ol>
  {/if}

  <div class="actions">
    <button class="primary" onclick={saveCsv} disabled={!columns || reviews.length === 0 || running > 0}>{t('review.csv')}</button>
    <button onclick={close}>{t('review.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(900px, calc(100vw - 32px));
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
  .choose .button {
    display: inline-block;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    cursor: pointer;
  }
  .choose:focus-within .button {
    outline: 2px solid var(--focus);
  }
  .scroller {
    margin-top: 10px;
    max-height: 50vh;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th,
  td {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--surface-2);
  }
  tbody th {
    font-weight: 500;
  }
  .num,
  .goal {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .passed {
    color: var(--distribution);
    font-weight: 700;
  }
  .failed,
  .error {
    color: var(--danger);
  }
  .legend {
    font-size: 0.75rem;
    margin: 8px 0 0;
    padding-left: 1.6em;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
