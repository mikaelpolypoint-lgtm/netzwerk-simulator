<script lang="ts">
  import { t } from '../../i18n';

  /**
   * «Über / Lizenzen»: eigene Lizenz, Lizenzen der eingebauten Pakete
   * (vom Build in die Datei geschrieben) und Hinweise zu nachgebildeten
   * Befehlssyntaxen. MIT & Co. verlangen, dass diese Hinweise mitreisen.
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

  const OWN_LICENSE = `MIT License

Copyright (c) 2026 Mikael von Allmen & vonam-git

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  $effect(() => {
    dialog.showModal();
  });

  function close() {
    dialog.close();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="about-title" onclose={onclose}>
  <h2 id="about-title">{t('app.title')}</h2>
  <p class="muted">{t('about.version', { version: __APP_VERSION__ })}</p>
  <p>{t('about.intro')}</p>

  <h3>{t('about.ownLicense')}</h3>
  <details>
    <summary>MIT · © 2026 Mikael von Allmen & vonam-git</summary>
    <pre>{OWN_LICENSE}</pre>
  </details>

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
