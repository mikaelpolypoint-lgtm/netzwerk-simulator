<script lang="ts">
  import { t } from '../../i18n';
  import Logo from './Logo.svelte';

  /**
   * «Über / Lizenzen»: eigene Lizenz, Lizenzen der eingebauten Pakete
   * (vom Build in die Datei geschrieben) und Hinweise zu nachgebildeten
   * Befehlssyntaxen. MIT & Co. verlangen, dass diese Hinweise mitreisen;
   * die AGPL (Abschnitt 13), dass Nutzer der Webversion den Quellcode finden.
   */
  let { onclose }: { onclose: () => void } = $props();

  interface ThirdParty {
    name: string;
    version: string;
    license: string;
    homepage: string;
    text: string | null;
  }

  let dialog: HTMLDialogElement;

  const packages: ThirdParty[] = (() => {
    const node = document.getElementById('third-party-licenses');
    if (!node?.textContent) return [];
    try {
      return JSON.parse(node.textContent) as ThirdParty[];
    } catch {
      return [];
    }
  })();

  const SOURCE = 'https://github.com/vonam-git/leyoNET';
  const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

  $effect(() => {
    dialog.showModal();
  });

  function close() {
    dialog.close();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="about-title" onclose={onclose}>
  <h2 id="about-title" class="title"><Logo height={56} label={t('app.title')} /></h2>
  <p class="muted">{t('about.version', { version: __APP_VERSION__ })} · {t('about.tagline')}</p>
  <p>{t('about.intro')}</p>

  <section class="story" aria-labelledby="story-title">
    <h3 id="story-title">{t('about.storyTitle')}</h3>
    <p>{t('about.story1')}</p>
    <p>{t('about.story2')}</p>
    <p>{t('about.story3')}</p>
    <div class="name">
      <Logo variant="mark" height={44} label="ly" />
      <p>{t('about.story4')}</p>
    </div>
  </section>

  <h3>{t('about.ownLicense')}</h3>
  <p class="small">© 2026 Mark von Allmen &amp; Mikael von Allmen</p>
  <p class="small">{t('about.license')}</p>
  <p class="small">{t('about.trademark')}</p>
  <p class="small">
    {t('about.source')} <a href={SOURCE} target="_blank" rel="noopener noreferrer">{SOURCE.replace('https://', '')}</a> ·
    <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">GNU AGPL v3</a>
  </p>

  <h3>{t('about.thirdParty')}</h3>
  {#if packages.length === 0}
    <p class="muted">{t('about.devBuild')}</p>
  {:else}
    <p class="muted">{t('about.thirdPartyHint')}</p>
    {#each packages as p (p.name)}
      <details>
        <summary>{p.name} {p.version} · {p.license}</summary>
        {#if p.homepage}<p class="muted small">{p.homepage}</p>{/if}
        <pre>{p.text ?? p.license}</pre>
      </details>
    {/each}
  {/if}

  <h3>{t('about.syntaxTitle')}</h3>
  <p class="small">{t('about.syntaxText')}</p>

  <div class="actions">
    <button onclick={close}>{t('about.close')}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    padding: 20px 24px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 1.2rem;
  }
  .title {
    color: var(--text);
  }
  .story p {
    margin: 6px 0;
    line-height: 1.5;
  }
  .name {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-2);
    --logo-bg: transparent;
  }
  .name p {
    margin: 0;
  }
  a {
    color: var(--accent);
  }
  h3 {
    margin: 18px 0 6px;
    font-size: 0.95rem;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
  .small {
    font-size: 0.85rem;
  }
  details {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    margin: 6px 0;
  }
  summary {
    cursor: pointer;
    font-size: 0.9rem;
  }
  pre {
    white-space: pre-wrap;
    font-size: 0.75rem;
    max-height: 240px;
    overflow: auto;
    margin: 8px 0 2px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
