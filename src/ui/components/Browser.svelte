<script lang="ts">
  import { formatUrl, parseUrl, resolveLink, type Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';

  /** Desktop-Anwendung "Webbrowser": URL eingeben, Ablauf verfolgen, Seite ansehen. */
  let { device }: { device: Device } = $props();

  let address = $state('http://');
  let view = $state<'page' | 'source'>('page');
  let frame: HTMLIFrameElement | undefined = $state();

  const browser = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id).browser));
  const response = $derived(browser?.response);

  function load(url: string) {
    address = url;
    simStore.browse(device.id, url);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (address.trim()) load(address);
  }

  // Links in der Seite führen nicht ins echte Netz, sondern lösen einen simulierten Abruf aus.
  // Die Seite läuft ohne Skripte (sandbox), aber im selben Ursprung, damit Klicks abfangbar sind.
  function onFrameLoad() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!link) return;
      event.preventDefault();
      const base = browser ? parseUrl(browser.url) : 'invalidUrl';
      if (typeof base === 'string') return;
      const target = resolveLink(base, link.getAttribute('href') ?? '');
      if (typeof target !== 'string') load(formatUrl(target));
    });
  }
</script>

<div class="browser">
  <form class="bar" onsubmit={submit}>
    <label class="visually-hidden" for="browser-url">{t('browser.address')}</label>
    <input id="browser-url" bind:value={address} autocomplete="off" spellcheck="false" placeholder="http://webserver1/index.html" />
    <button type="submit">{t('browser.go')}</button>
    <span class="views" role="group" aria-label={t('browser.view')}>
      <button type="button" aria-pressed={view === 'page'} onclick={() => (view = 'page')}>{t('browser.viewPage')}</button>
      <button type="button" aria-pressed={view === 'source'} onclick={() => (view = 'source')}>{t('browser.viewSource')}</button>
    </span>
  </form>

  {#if browser}
    <ol class="steps" aria-label={t('browser.steps')} aria-live="polite">
      {#each browser.steps as step, i (i)}
        <li class:error={browser.status === 'error' && i === browser.steps.length - 1}>
          <span class="time">{(step.time / 1000).toFixed(3)}</span>
          {t(`console.${step.code}`, step.params)}
        </li>
      {/each}
      {#if browser.status === 'loading'}
        <li class="muted">{t('browser.loading')}</li>
      {/if}
    </ol>
  {/if}

  <div class="page">
    {#if !browser}
      <p class="muted pad">{t('browser.empty')}</p>
    {:else if view === 'source'}
      <pre>{browser.raw ?? t('browser.noSource')}</pre>
    {:else if response}
      <iframe
        bind:this={frame}
        title={t('browser.pageTitle', { url: browser.url })}
        sandbox="allow-same-origin"
        srcdoc={response.body}
        onload={onFrameLoad}
      ></iframe>
    {/if}
  </div>
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .bar {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .bar input {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.85rem;
    padding: 4px 8px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .views {
    display: flex;
    gap: 2px;
  }
  .views button,
  .bar button {
    font-size: 0.8rem;
    padding: 3px 8px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 6px 10px;
    max-height: 110px;
    overflow-y: auto;
    font-size: 0.75rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .steps li.error {
    color: var(--danger);
    font-weight: 600;
  }
  .time {
    color: var(--muted);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    margin-right: 6px;
  }
  .page {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: #fff;
    color: #111;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    background: #fff;
  }
  pre {
    margin: 0;
    padding: 8px 10px;
    font-size: 0.75rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .pad {
    padding: 12px;
    margin: 0;
  }
  .muted {
    color: var(--muted);
  }
</style>
