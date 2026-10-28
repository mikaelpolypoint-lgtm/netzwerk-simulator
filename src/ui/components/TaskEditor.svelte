<script lang="ts">
  import { CHECK_TYPES, DEVICE_TYPES, readTasks, type Check, type TaskSet } from '../../core';
  import { t } from '../../i18n';
  import { typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { CHECK_FIELDS, PROTOCOLS, emptyGoal, fromDraft, suggestedText, toDraft, type DraftError, type TaskDraft } from '../taskForm';

  /**
   * Für Lehrpersonen: Aufgabe im Formular oder als JSON bearbeiten. Mit
   * "Speichern" in der Werkzeugleiste entsteht daraus eine Aufgabendatei.
   */
  let { onclose }: { onclose: () => void } = $props();

  const template: TaskSet = {
    title: 'Titel der Aufgabe',
    description: 'Was die Lernenden tun sollen.',
    goals: [
      { id: 'kabel', text: 'PC 1 ist mit Switch 1 verkabelt.', check: { type: 'connected', a: 'PC 1', b: 'Switch 1' } },
      { id: 'netz', text: 'PC 1 liegt im Netz 192.168.1.0/24.', check: { type: 'inNetwork', device: 'PC 1', network: '192.168.1.0/24' } },
      { id: 'ping', text: 'PC 1 erreicht PC 2.', check: { type: 'ping', from: 'PC 1', to: 'PC 2' }, hint: 'Stimmen Adressen und Masken?' },
    ],
  };

  let mode = $state<'form' | 'json'>('form');
  let draft = $state<TaskDraft>(toDraft(editor.tasks ?? template));
  let text = $state('');
  let error = $state<string | null>(null);
  let errorGoal = $state<number | null>(null);
  let dialog: HTMLDialogElement;

  const deviceNames = $derived(editor.topology.devices.map((d) => d.name));

  $effect(() => {
    dialog.showModal();
  });

  function draftError(e: DraftError): string {
    if (e.code === 'noGoals') return t('taskForm.noGoals');
    if (e.goal === undefined) return t('taskForm.required', { field: t(`taskForm.${e.field}`) });
    const spec = CHECK_FIELDS[draft.goals[e.goal]!.type].find((f) => f.key === e.field)!;
    const field = t(`taskForm.field.${spec.label ?? spec.key}`);
    return t(e.code === 'required' ? 'taskForm.requiredIn' : 'taskForm.notANumber', { n: e.goal + 1, field });
  }

  /** Aufgabe aus der aktiven Ansicht lesen; null bei Fehler (dann ist `error` gesetzt). */
  function current(): TaskSet | null {
    error = null;
    errorGoal = null;
    if (mode === 'form') {
      const result = fromDraft($state.snapshot(draft));
      if (result.ok) return result.tasks;
      error = draftError(result.error);
      errorGoal = result.error.goal ?? null;
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      error = t('error.invalidJson');
      return null;
    }
    try {
      return readTasks(data, (path) => {
        throw new Error(path);
      });
    } catch (e) {
      error = t('tasks.invalid', { path: (e as Error).message });
      return null;
    }
  }

  function switchTo(next: 'form' | 'json') {
    if (next === mode) return;
    const tasks = current();
    if (!tasks) {
      if (mode === 'json') error = t('taskForm.jsonInvalid');
      return;
    }
    if (next === 'json') text = JSON.stringify(tasks, null, 2);
    else draft = toDraft(tasks);
    mode = next;
  }

  function apply() {
    const tasks = current();
    if (!tasks) return;
    editor.setTasks(tasks);
    close();
  }

  function remove() {
    editor.setTasks(null);
    close();
  }

  function close() {
    dialog.close();
    onclose();
  }

  function addGoal() {
    draft.goals.push(emptyGoal(draft));
  }

  function move(i: number, by: number) {
    const [goal] = draft.goals.splice(i, 1);
    draft.goals.splice(i + by, 0, goal!);
  }

  function changeType(i: number, type: Check['type']) {
    const goal = draft.goals[i]!;
    // Felder mit gleichem Namen (z.B. "from") behalten, den Rest verwerfen.
    const keys = new Set(CHECK_FIELDS[type].map((f) => f.key));
    goal.fields = Object.fromEntries(Object.entries(goal.fields).filter(([k]) => keys.has(k)));
    goal.type = type;
  }
</script>

<dialog bind:this={dialog} aria-labelledby="task-editor-title" onclose={onclose}>
  <div class="top">
    <h2 id="task-editor-title">{t('tasks.editorTitle')}</h2>
    <div class="tabs" role="group">
      <button class:active={mode === 'form'} aria-pressed={mode === 'form'} onclick={() => switchTo('form')}>{t('taskForm.form')}</button>
      <button class:active={mode === 'json'} aria-pressed={mode === 'json'} onclick={() => switchTo('json')}>{t('taskForm.json')}</button>
    </div>
  </div>

  <datalist id="task-devices">
    {#each deviceNames as name (name)}
      <option value={name}></option>
    {/each}
  </datalist>
  <datalist id="task-protocols">
    {#each PROTOCOLS as p (p)}
      <option value={p}></option>
    {/each}
  </datalist>

  <div class="body">
    {#if mode === 'form'}
      <p class="muted">{t('taskForm.help')}</p>
      <label class="field">
        {t('taskForm.title')}
        <input bind:value={draft.title} />
      </label>
      <label class="field">
        {t('taskForm.description')}
        <textarea class="description" bind:value={draft.description}></textarea>
      </label>

      <h3>{t('taskForm.goals')}</h3>
      <ol class="goals">
        {#each draft.goals as goal, i (goal.id)}
          <li class:invalid={errorGoal === i}>
            <fieldset>
              <legend>{t('taskForm.goal', { n: i + 1 })}</legend>
              <div class="goal-tools">
                <button class="icon" onclick={() => move(i, -1)} disabled={i === 0} aria-label={t('taskForm.up')} title={t('taskForm.up')}>↑</button>
                <button class="icon" onclick={() => move(i, 1)} disabled={i === draft.goals.length - 1} aria-label={t('taskForm.down')} title={t('taskForm.down')}>↓</button>
                <button class="icon danger" onclick={() => draft.goals.splice(i, 1)} aria-label={t('taskForm.removeGoal')} title={t('taskForm.removeGoal')}>✕</button>
              </div>
              <div class="grid">
                <label class="field">
                  {t('taskForm.check')}
                  <select value={goal.type} onchange={(e) => changeType(i, e.currentTarget.value as Check['type'])}>
                    {#each CHECK_TYPES as type (type)}
                      <option value={type}>{t(`taskForm.type.${type}`)}</option>
                    {/each}
                  </select>
                </label>
                {#each CHECK_FIELDS[goal.type] as spec (spec.key)}
                  <label class="field">
                    {t(`taskForm.field.${spec.label ?? spec.key}`)}
                    {#if spec.kind === 'deviceType'}
                      <select bind:value={goal.fields[spec.key]}>
                        <option value="">{t('taskForm.any')}</option>
                        {#each DEVICE_TYPES as type (type)}
                          <option value={type}>{typeLabel(type)}</option>
                        {/each}
                      </select>
                    {:else}
                      <input
                        bind:value={goal.fields[spec.key]}
                        list={spec.kind === 'device' ? 'task-devices' : spec.kind === 'protocol' ? 'task-protocols' : undefined}
                        inputmode={spec.kind === 'number' ? 'numeric' : undefined}
                        spellcheck="false"
                      />
                    {/if}
                  </label>
                {/each}
              </div>
              <label class="field">
                {t('taskForm.text')}
                <input bind:value={goal.text} placeholder={suggestedText(goal)} />
              </label>
              <label class="field">
                {t('taskForm.hint')}
                <input bind:value={goal.hint} />
              </label>
            </fieldset>
          </li>
        {/each}
      </ol>
      <button onclick={addGoal}>{t('taskForm.addGoal')}</button>
    {:else}
      <p class="muted">{t('tasks.editorHelp')}</p>
      <textarea class="json" bind:value={text} spellcheck="false" aria-label={t('tasks.editorTitle')}></textarea>
    {/if}
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <div class="actions">
    <button class="primary" onclick={apply}>{t('config.apply')}</button>
    <button onclick={close}>{t('web.cancel')}</button>
    {#if editor.tasks}
      <button class="danger remove" onclick={remove}>{t('tasks.remove')}</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
    display: flex;
    flex-direction: column;
  }
  dialog:not([open]) {
    display: none;
  }
  dialog::backdrop {
    background: rgba(15, 23, 42, 0.4);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  h3 {
    margin: 12px 0 6px;
    font-size: 0.9rem;
  }
  .tabs {
    display: flex;
  }
  .tabs button {
    border-radius: 0;
  }
  .tabs button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .tabs button:last-child {
    border-radius: 0 6px 6px 0;
    margin-left: -1px;
  }
  .tabs .active {
    background: var(--selected-soft);
    font-weight: 600;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.8rem;
    margin-bottom: 6px;
  }
  input,
  select,
  textarea {
    font: inherit;
    padding: 3px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .description {
    min-height: 3.5em;
    resize: vertical;
  }
  .goals {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  fieldset {
    position: relative;
    margin: 0;
    padding: 6px 10px 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .invalid fieldset {
    border-color: var(--danger);
  }
  legend {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0 4px;
  }
  .goal-tools {
    position: absolute;
    top: -4px;
    right: 8px;
    display: flex;
    gap: 2px;
  }
  .icon {
    padding: 0 6px;
    font-size: 0.75rem;
    line-height: 1.5;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 0 8px;
  }
  .json {
    width: 100%;
    height: 50vh;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 8px;
    background: var(--surface-2);
    border-radius: 6px;
    resize: vertical;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .remove {
    margin-left: auto;
  }
  .error {
    color: var(--danger);
    margin: 6px 0 0;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0 0 8px;
  }
</style>
