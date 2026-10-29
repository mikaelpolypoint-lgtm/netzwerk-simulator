<script lang="ts">
  import { parseProject, reviewSubmission, type SubmissionReview } from '../../core';
  import { locale, t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { api, ApiError, session } from '../state/session.svelte';
  import { FEATURES, FEATURE_GROUPS, PROFILE_LEVELS } from '../features';
  import { featureName } from '../labels';
  import { normalizePolicy, ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';

  /**
   * Admin-Dashboard der Webversion: Einstellungen (erlaubte Modi, Pro,
   * Speicherdauer), Klassen-Sessions und Rückmeldungen. Die Anmeldung gilt
   * nur in diesem Tab (Token im Arbeitsspeicher).
   */
  let { onclose }: { onclose: () => void } = $props();

  interface Settings {
    modes: { design: boolean; simulation: boolean };
    maxLevel: number;
    defaultLevel: number;
    disabled: string[];
    sessionHours: number;
    feedbackEnabled: boolean;
    feedbackDays: number;
    classHours: number;
  }
  interface ClassInfo {
    code: string;
    label: string;
    created: number;
    expires: number;
    sessions: number;
  }
  interface Overview {
    settings: Settings;
    sessions: number;
    classes: ClassInfo[];
    feedbackOpen: number;
    feedbackTotal: number;
  }
  interface Feedback {
    id: string;
    kind: string;
    text: string;
    created: number;
    status: 'open' | 'done';
    version: string;
    locale: string;
    hasProject: boolean;
  }
  interface ClassSession {
    code: string;
    created: number;
    updated: number;
    expires: number;
    devices: number;
    cables: number;
    task: string | null;
  }

  let token = $state<string | null>(adminToken.value);
  let password = $state('');
  interface CheckResult {
    id: string;
    category: 'privacy' | 'security' | 'licenses';
    status: 'pass' | 'warn' | 'fail' | 'skipped';
    detail: string;
  }
  interface ChecksReport {
    version: string;
    date: string;
    checks: CheckResult[];
  }

  let tab = $state<'settings' | 'classes' | 'feedback' | 'checks'>('classes');
  let checks = $state<ChecksReport | null>(null);
  let checksMissing = $state(false);
  let overview = $state<Overview | null>(null);
  let feedback = $state<Feedback[]>([]);
  let draft = $state<Settings | null>(null);
  let label = $state('');
  let openClass = $state<ClassInfo | null>(null);
  let classSessions = $state<ClassSession[]>([]);
  let reviews = $state<Record<string, SubmissionReview>>({});
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const when = (ms: number) =>
    new Date(ms).toLocaleString(locale() === 'en' ? 'en-GB' : 'de-CH', { dateStyle: 'short', timeStyle: 'short' });

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await api<T>(method, `admin/${path}`, body, token ?? undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        token = null;
        adminToken.value = null;
      }
      throw error;
    }
  }

  async function login(event: SubmitEvent) {
    event.preventDefault();
    message = null;
    try {
      const data = await api<{ token: string }>('POST', 'admin/login', { password });
      token = data.token;
      adminToken.value = data.token;
      password = '';
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'error';
      message = { kind: 'error', text: t(`admin.error.${['wrongPassword', 'adminDisabled', 'rateLimited'].includes(code) ? code : 'other'}`) };
    }
  }

  async function refresh() {
    overview = await call<Overview>('GET', 'overview');
    draft = $state.snapshot(overview.settings);
    feedback = await call<Feedback[]>('GET', 'feedback');
    try {
      checks = await call<ChecksReport>('GET', 'checks');
      checksMissing = false;
    } catch {
      checks = null;
      checksMissing = true;
    }
    if (openClass) await showClass(openClass);
  }

  $effect(() => {
    if (token && !overview) refresh().catch(() => (message = { kind: 'error', text: t('admin.loadFailed') }));
  });

  async function logout() {
    await call('POST', 'logout').catch(() => undefined);
    token = null;
    adminToken.value = null;
    overview = null;
  }

  async function saveSettings() {
    if (!draft) return;
    const saved = await call<Settings>('PUT', 'settings', draft);
    draft = saved;
    ui.setPolicy(normalizePolicy(saved));
    await session.loadConfig();
    message = { kind: 'ok', text: t('admin.saved') };
  }

  async function createClass(event: SubmitEvent) {
    event.preventDefault();
    const created = await call<ClassInfo>('POST', 'classes', { label });
    label = '';
    await refresh();
    message = { kind: 'ok', text: t('admin.classCreated', { label: created.label, code: created.code }) };
  }

  async function showClass(c: ClassInfo) {
    openClass = c;
    reviews = {};
    classSessions = await call<ClassSession[]>('GET', `classes/${c.code}/sessions`);
  }

  async function closeClass(c: ClassInfo) {
    if (!confirm(t('admin.closeClassConfirm', { label: c.label, n: c.sessions }))) return;
    await call('DELETE', `classes/${c.code}`);
    if (openClass?.code === c.code) openClass = null;
    await refresh();
  }

  async function loadSession(code: string) {
    const data = await call<{ project: unknown }>('GET', `sessions/${code}`);
    const parsed = parseProject(JSON.stringify(data.project));
    if (!parsed.ok) return;
    editor.replace(parsed.topology, { undoable: true, tasks: parsed.tasks ?? null, snapshots: parsed.snapshots ?? [] });
    message = { kind: 'ok', text: t('admin.loaded', { code }) };
  }

  /** Alle Sessions der Klasse gegen die geladene Aufgabe (oder ihre eigene) prüfen. */
  async function reviewAll() {
    const next: Record<string, SubmissionReview> = {};
    for (const s of classSessions) {
      const data = await call<{ project: unknown }>('GET', `sessions/${s.code}`);
      next[s.code] = reviewSubmission(s.code, JSON.stringify(data.project), editor.tasks);
    }
    reviews = next;
  }

  const score = (r: SubmissionReview | undefined) => {
    if (!r) return '';
    if (!r.ok) return t('review.error');
    const counted = r.marks.filter((m) => !m.skipped);
    return `${counted.filter((m) => m.passed).length}/${counted.length}`;
  };

  async function setStatus(f: Feedback, status: 'open' | 'done') {
    await call('PATCH', `feedback/${f.id}`, { status });
    await refresh();
  }

  async function removeFeedback(f: Feedback) {
    await call('DELETE', `feedback/${f.id}`);
    await refresh();
  }

  async function openFeedbackProject(f: Feedback) {
    const data = await call<{ project: unknown }>('GET', `feedback/${f.id}`);
    const parsed = parseProject(JSON.stringify(data.project));
    if (parsed.ok) editor.replace(parsed.topology, { undoable: true, tasks: parsed.tasks ?? null });
  }

  async function purgeSessions() {
    if (!confirm(t('admin.purgeConfirm', { n: overview?.sessions ?? 0 }))) return;
    await call('DELETE', 'sessions');
    await refresh();
  }
</script>

<script lang="ts" module>
  /** Admin-Anmeldung nur für diesen Tab, nicht dauerhaft gespeichert. */
  export const adminToken: { value: string | null } = { value: null };
</script>

<Modal title={t('admin.title')} {onclose} width={860}>
  {#if !ui.online}
    <p class="muted">{t('settings.onlineOnly')}</p>
  {:else if !token}
    <form class="login" onsubmit={login}>
      <label>
        <span>{t('admin.password')}</span>
        <input type="password" bind:value={password} autocomplete="current-password" required />
      </label>
      <button type="submit">{t('admin.login')}</button>
    </form>
    <p class="muted">{t('admin.loginHint')}</p>
  {:else if overview && draft}
    <div class="head">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'classes'} onclick={() => (tab = 'classes')}>{t('admin.tab.classes')} ({overview.classes.length})</button>
        <button role="tab" aria-selected={tab === 'feedback'} onclick={() => (tab = 'feedback')}>
          {t('admin.tab.feedback')} ({overview.feedbackOpen}/{overview.feedbackTotal})
        </button>
        <button role="tab" aria-selected={tab === 'settings'} onclick={() => (tab = 'settings')}>{t('admin.tab.settings')}</button>
        <button role="tab" aria-selected={tab === 'checks'} onclick={() => (tab = 'checks')}>
          {t('admin.tab.checks')}
          {#if checks}
            {@const bad = checks.checks.filter((c) => c.status === 'fail').length}
            <span class="pill" class:bad={bad > 0}>{bad > 0 ? bad : '✓'}</span>
          {/if}
        </button>
      </div>
      <button class="ghost" onclick={() => refresh()}>{t('admin.refresh')}</button>
      <button class="ghost" onclick={logout}>{t('admin.logout')}</button>
    </div>

    {#if tab === 'settings'}
      <h3>{t('admin.modesTitle')}</h3>
      <p class="muted">{t('admin.modesHint')}</p>
      <div class="checks">
        {#each ['design', 'simulation'] as const as m (m)}
          <label><input type="checkbox" bind:checked={draft.modes[m]} /> {t(`mode.${m}`)}</label>
        {/each}
      </div>
      <h3>{t('admin.profileTitle')}</h3>
      <p class="muted">{t('admin.profileHint')}</p>
      <div class="grid">
        <label><span>{t('admin.defaultLevel')}</span>
          <select bind:value={draft.defaultLevel}>{#each PROFILE_LEVELS as l (l)}<option value={l}>{t(`profile.${l}`)}</option>{/each}</select>
        </label>
        <label><span>{t('admin.maxLevel')}</span>
          <select bind:value={draft.maxLevel}>{#each PROFILE_LEVELS as l (l)}<option value={l}>{t(`profile.${l}`)}</option>{/each}</select>
        </label>
      </div>
      <details class="blocked">
        <summary>{t('admin.disabledTitle', { n: draft.disabled.length })}</summary>
        <p class="muted">{t('admin.disabledHint')}</p>
        <div class="feature-groups">
          {#each FEATURE_GROUPS as group (group)}
            <fieldset>
              <legend>{t(`features.group.${group}`)}</legend>
              {#each FEATURES.filter((f) => f.group === group) as spec (spec.id)}
                <label>
                  <input
                    type="checkbox"
                    checked={draft.disabled.includes(spec.id)}
                    onchange={(e) => (draft!.disabled = e.currentTarget.checked ? [...draft!.disabled, spec.id] : draft!.disabled.filter((x) => x !== spec.id))}
                  />
                  {featureName(spec.id)}
                </label>
              {/each}
            </fieldset>
          {/each}
        </div>
      </details>
      <h3>{t('admin.retentionTitle')}</h3>
      <div class="grid">
        <label><span>{t('admin.sessionHours')}</span><input type="number" min="1" max="720" bind:value={draft.sessionHours} /></label>
        <label><span>{t('admin.classHours')}</span><input type="number" min="1" max="4320" bind:value={draft.classHours} /></label>
        <label><span>{t('admin.feedbackDays')}</span><input type="number" min="1" max="365" bind:value={draft.feedbackDays} /></label>
        <label class="inline"><input type="checkbox" bind:checked={draft.feedbackEnabled} /> {t('admin.feedbackEnabled')}</label>
      </div>
      <p class="muted">{t('admin.retentionHint')}</p>
      <div class="row">
        <button onclick={saveSettings}>{t('admin.save')}</button>
        <span class="muted">{t('admin.sessionCount', { n: overview.sessions })}</span>
        <button class="danger" onclick={purgeSessions} disabled={overview.sessions === 0}>{t('admin.purge')}</button>
      </div>
    {:else if tab === 'checks'}
      <p class="muted">{t('admin.checksHint')}</p>
      {#if checksMissing || !checks}
        <p class="muted">{t('admin.checksMissing')}</p>
      {:else}
        <p>{t('admin.checksVersion', { version: checks.version, date: when(Date.parse(checks.date)) })}</p>
        {#each ['privacy', 'security', 'licenses'] as const as category (category)}
          <h3>{t(`checks.category.${category}`)}</h3>
          <ul class="checklist">
            {#each checks.checks.filter((c) => c.category === category) as c (c.id)}
              <li class="status-{c.status}">
                <span class="badge">{t(`checks.status.${c.status}`)}</span>
                <span><strong>{t(`checks.${c.id}`)}</strong><br /><span class="muted">{c.detail}</span></span>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    {:else if tab === 'classes'}
      <form class="row" onsubmit={createClass}>
        <input bind:value={label} maxlength="40" placeholder={t('admin.classLabelPlaceholder')} aria-label={t('admin.classLabel')} required />
        <button type="submit">{t('admin.createClass')}</button>
      </form>
      <p class="muted">{t('admin.classHint')}</p>
      {#if overview.classes.length === 0}
        <p class="muted">{t('admin.noClasses')}</p>
      {:else}
        <table>
          <thead>
            <tr><th>{t('admin.classLabel')}</th><th>{t('admin.classCode')}</th><th>{t('admin.sessions')}</th><th>{t('admin.until')}</th><th></th></tr>
          </thead>
          <tbody>
            {#each overview.classes as c (c.code)}
              <tr class:active={openClass?.code === c.code}>
                <td>{c.label}</td>
                <td class="code">{c.code}</td>
                <td>{c.sessions}</td>
                <td>{when(c.expires)}</td>
                <td class="actions">
                  <button onclick={() => showClass(c)}>{t('admin.show')}</button>
                  <button class="danger" onclick={() => closeClass(c)}>{t('admin.closeClass')}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if openClass}
        <h3>{t('admin.classSessions', { label: openClass.label })}</h3>
        {#if classSessions.length === 0}
          <p class="muted">{t('admin.noSessions', { code: openClass.code })}</p>
        {:else}
          <div class="row">
            <button onclick={reviewAll}>{t('admin.reviewAll')}</button>
            <span class="muted">{editor.tasks ? t('review.helpTask', { title: editor.tasks.title }) : t('admin.reviewOwn')}</span>
          </div>
          <table>
            <thead>
              <tr><th>{t('admin.sessionCode')}</th><th>{t('admin.changed')}</th><th>{t('admin.devices')}</th><th>{t('review.score')}</th><th></th></tr>
            </thead>
            <tbody>
              {#each classSessions as s (s.code)}
                <tr>
                  <td class="code">{s.code}</td>
                  <td>{when(s.updated)}</td>
                  <td>{s.devices} / {s.cables}</td>
                  <td>{score(reviews[s.code])}</td>
                  <td class="actions"><button onclick={() => loadSession(s.code)}>{t('admin.open')}</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    {:else}
      {#if feedback.length === 0}
        <p class="muted">{t('admin.noFeedback')}</p>
      {:else}
        <ul class="feedback">
          {#each feedback as f (f.id)}
            <li class:done={f.status === 'done'}>
              <div class="meta">
                <strong>{t(`feedback.kind.${f.kind}`)}</strong>
                <span class="muted">{when(f.created)} · v{f.version} · {f.locale}</span>
              </div>
              <p>{f.text}</p>
              <div class="row">
                {#if f.status === 'open'}
                  <button onclick={() => setStatus(f, 'done')}>{t('admin.markDone')}</button>
                {:else}
                  <button onclick={() => setStatus(f, 'open')}>{t('admin.reopen')}</button>
                {/if}
                {#if f.hasProject}<button onclick={() => openFeedbackProject(f)}>{t('admin.openProject')}</button>{/if}
                <button class="danger" onclick={() => removeFeedback(f)}>{t('inspector.delete')}</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {:else}
    <p class="muted">…</p>
  {/if}
  {#if message}<p class={message.kind} role="status">{message.text}</p>{/if}
</Modal>

<style>
  .pill {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    background: #16a34a;
    color: #fff;
  }
  .pill.bad {
    background: var(--danger);
  }
  .feature-groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .feature-groups fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.8rem;
  }
  .feature-groups label {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .blocked summary {
    cursor: pointer;
    font-weight: 600;
    margin: 10px 0 4px;
  }
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .checklist li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .checklist .badge {
    flex: none;
    width: 5.5rem;
    text-align: center;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.72rem;
    color: #fff;
  }
  .status-pass .badge {
    background: #16a34a;
  }
  .status-warn .badge {
    background: #d97706;
  }
  .status-fail .badge {
    background: var(--danger);
  }
  .status-skipped .badge {
    background: #6b7280;
  }
  .login {
    display: flex;
    gap: 8px;
    align-items: end;
  }
  .login label {
    display: grid;
    gap: 4px;
    flex: 1;
    font-size: 0.85rem;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  .tabs button[aria-selected='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  .ghost {
    border-style: dashed;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px 14px;
    font-size: 0.85rem;
  }
  .grid label {
    display: grid;
    gap: 4px;
  }
  .grid .inline {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  .row input {
    flex: 1;
  }
  .actions {
    white-space: nowrap;
    text-align: right;
  }
  .actions button {
    font-size: 0.8rem;
    padding: 3px 8px;
  }
  tr.active td {
    background: var(--selected-soft);
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .feedback {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
    max-height: 55vh;
    overflow: auto;
  }
  .feedback li {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .feedback li.done {
    opacity: 0.6;
  }
  .feedback p {
    margin: 6px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
</style>
