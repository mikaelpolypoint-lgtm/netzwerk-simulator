<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';

  /** Desktop-Anwendung "E-Mail": Posteingang, Verfassen, Protokoll des Mail-Dialogs. */
  let { device }: { device: Device } = $props();

  let view = $state<'inbox' | 'compose' | 'log'>('inbox');
  let open = $state<string | null>(null);
  let draft = $state({ to: '', subject: '', body: '' });

  const mail = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id).mail));
  const account = $derived(device.mailAccount);
  const selected = $derived(mail?.inbox.find((m) => m.id === open));

  function send(event: SubmitEvent) {
    event.preventDefault();
    const to = draft.to.split(/[,;\s]+/).filter(Boolean);
    simStore.sendMail(device.id, { to, subject: draft.subject, body: draft.body.replace(/\r?\n/g, '\r\n') });
    draft = { to: '', subject: '', body: '' };
    view = 'log';
  }

  function fetchMail() {
    simStore.fetchMail(device.id);
  }
</script>

<div class="mail">
  {#if !account}
    <p class="muted pad">{t('mailApp.noAccount')}</p>
  {:else}
    <div class="bar">
      <span class="account">{account.address}</span>
      <button onclick={fetchMail} disabled={mail?.busy}>{t('mailApp.fetch', { protocol: account.protocol.toUpperCase() })}</button>
      <span class="views" role="tablist">
        {#each ['inbox', 'compose', 'log'] as v (v)}
          <button role="tab" aria-selected={view === v} onclick={() => (view = v as typeof view)}>{t(`mailApp.view.${v}`)}</button>
        {/each}
      </span>
    </div>

    {#if view === 'inbox'}
      <div class="inbox">
        <ul class="list">
          {#each [...(mail?.inbox ?? [])].reverse() as m (m.id)}
            <li>
              <button class:active={open === m.id} onclick={() => (open = m.id)}>
                <strong>{m.subject || t('mailApp.noSubject')}</strong>
                <span class="muted">{m.from}</span>
              </button>
            </li>
          {:else}
            <li class="muted pad">{t('mailApp.empty')}</li>
          {/each}
        </ul>
        {#if selected}
          <article class="message">
            <dl>
              <dt>{t('mailApp.from')}</dt>
              <dd>{selected.from}</dd>
              <dt>{t('mailApp.to')}</dt>
              <dd>{selected.to.join(', ')}</dd>
              <dt>{t('mailApp.subject')}</dt>
              <dd>{selected.subject}</dd>
            </dl>
            <pre>{selected.body}</pre>
          </article>
        {/if}
      </div>
    {:else if view === 'compose'}
      <form class="compose" onsubmit={send}>
        <label><span>{t('mailApp.to')}</span><input bind:value={draft.to} placeholder="ben@schule.example" autocomplete="off" spellcheck="false" /></label>
        <label><span>{t('mailApp.subject')}</span><input bind:value={draft.subject} autocomplete="off" /></label>
        <label class="grow"><span>{t('mailApp.body')}</span><textarea bind:value={draft.body}></textarea></label>
        <button type="submit" disabled={!draft.to.trim() || mail?.busy}>{t('mailApp.send')}</button>
      </form>
    {:else}
      <ol class="log" aria-live="polite">
        {#each mail?.steps ?? [] as step, i (i)}
          {#if step.code === 'mail.dialog'}
            <li class="dialog dir-{step.params?.dir}"><span class="dir">{step.params?.dir}:</span> {step.params?.line}</li>
          {:else}
            <li><span class="time">{(step.time / 1000).toFixed(3)}</span> {t(`console.${step.code}`, step.params)}</li>
          {/if}
        {:else}
          <li class="muted">{t('mailApp.logEmpty')}</li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>

<style>
  .mail {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 0.85rem;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .account {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
  }
  .views {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .bar button {
    font-size: 0.8rem;
    padding: 3px 8px;
  }
  .views button[aria-selected='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  .inbox {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }
  .list button {
    display: grid;
    width: 100%;
    text-align: left;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: none;
  }
  .list button.active {
    background: var(--selected-soft);
  }
  .message {
    overflow-y: auto;
    padding: 8px 10px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0 0 8px;
    font-size: 0.8rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
  }
  .compose {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }
  .compose label {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
  }
  .compose .grow {
    flex: 1;
    grid-template-rows: auto 1fr;
  }
  input,
  textarea {
    width: 100%;
    font: inherit;
    font-size: 0.85rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  textarea {
    resize: none;
    height: 100%;
  }
  .compose button {
    align-self: flex-end;
  }
  .log {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 8px 10px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.75rem;
  }
  .dialog.dir-C {
    color: var(--accent);
  }
  .dir {
    font-weight: 700;
  }
  .time,
  .muted {
    color: var(--muted);
  }
  .pad {
    padding: 12px;
    margin: 0;
  }
</style>
