<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Entwurfsmodus, Rechner: Mailserver mit Domain und Postfächern. */
  let { device }: { device: Device } = $props();

  let domain = $state('');
  let mailbox = $state({ user: '', password: '' });
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    domain = device.mailServer?.domain ?? '';
  });

  function applyDomain(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.setMailDomain(device.id, domain);
    error = failure ? { field: 'domain', text: t(`error.${failure.code}`, failure.params) } : null;
  }

  function addMailbox(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.addMailbox(device.id, mailbox);
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
    if (!failure) mailbox = { user: '', password: '' };
  }
</script>

<label class="toggle">
  <input type="checkbox" checked={!!device.mailServer} onchange={(e) => editor.setMailServerEnabled(device.id, e.currentTarget.checked)} />
  {t('mailServer.enable')}
</label>

{#if device.mailServer}
  <form class="row" onsubmit={applyDomain}>
    <label>
      <span>{t('mailServer.domain')}</span>
      <input bind:value={domain} autocomplete="off" spellcheck="false" aria-invalid={error?.field === 'domain'} />
    </label>
    <button type="submit" disabled={domain.trim() === device.mailServer.domain}>{t('config.apply')}</button>
  </form>

  <h4>{t('mailServer.mailboxes')}</h4>
  {#if device.mailServer.mailboxes.length === 0}
    <p class="muted">{t('mailServer.noMailboxes')}</p>
  {:else}
    <ul class="boxes">
      {#each device.mailServer.mailboxes as box (box.user)}
        <li>
          <span class="mono">{box.user}@{device.mailServer.domain}</span>
          <button class="small" aria-label={t('mailServer.remove', { user: box.user })} onclick={() => editor.removeMailbox(device.id, box.user)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  <form class="row" onsubmit={addMailbox}>
    <label>
      <span>{t('mailServer.user')}</span>
      <input bind:value={mailbox.user} placeholder="anna" autocomplete="off" spellcheck="false" aria-invalid={error?.field === 'user'} />
    </label>
    <label>
      <span>{t('mailServer.password')}</span>
      <input bind:value={mailbox.password} autocomplete="off" spellcheck="false" aria-invalid={error?.field === 'password'} />
    </label>
    <button type="submit" disabled={!mailbox.user.trim()}>{t('mailServer.add')}</button>
  </form>
  {#if error}
    <p class="error" role="alert">{error.text}</p>
  {/if}
  <p class="muted">{t('mailServer.explain')}</p>
{/if}

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin-bottom: 6px;
  }
  .row label {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
  }
  input {
    width: 100%;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  h4 {
    margin: 8px 0 4px;
    font-size: 0.8rem;
  }
  .boxes {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font-size: 0.8rem;
  }
  .boxes li {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
  }
  .small {
    font-size: 0.7rem;
    padding: 1px 6px;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .error {
    margin: 0 0 6px;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .muted {
    margin: 4px 0 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
