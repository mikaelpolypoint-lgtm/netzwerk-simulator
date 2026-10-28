<script lang="ts">
  import { LOCALES, locale, setLocale, t, type Locale } from '../../i18n';
  import { ui, type Theme } from '../state/ui.svelte';

  /**
   * Menü «Einstellungen»: Darstellung, Sprache, Funktionsumfang und
   * Verweise auf Datenschutz, Über, Rückmeldung und Admin.
   */
  let {
    onabout,
    onprivacy,
    onfeedback,
    onadmin,
  }: { onabout: () => void; onprivacy: () => void; onfeedback: () => void; onadmin: () => void } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const THEMES: Theme[] = ['auto', 'light', 'dark'];
  const LANGUAGE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

  function onwindowclick(event: MouseEvent) {
    if (open && !root.contains(event.target as Node)) open = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      open = false;
    }
  }

  function pick(action: () => void) {
    open = false;
    action();
  }
</script>

<svelte:window onclick={onwindowclick} />

<div class="settings" bind:this={root} {onkeydown} role="presentation">
  <button aria-expanded={open} aria-haspopup="true" onclick={() => (open = !open)} title={t('settings.title')}>
    <span aria-hidden="true">⚙</span>
    {t('settings.title')}
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label={t('settings.title')}>
      <div class="group">
        <span class="label" id="set-theme">{t('settings.theme')}</span>
        <div class="seg" role="radiogroup" aria-labelledby="set-theme">
          {#each THEMES as theme (theme)}
            <button role="radio" aria-checked={ui.theme === theme} onclick={() => ui.setTheme(theme)}>{t(`settings.theme.${theme}`)}</button>
          {/each}
        </div>
      </div>
      <div class="group">
        <span class="label" id="set-lang">{t('toolbar.language')}</span>
        <div class="seg" role="radiogroup" aria-labelledby="set-lang">
          {#each LOCALES as code (code)}
            <button role="radio" aria-checked={locale() === code} onclick={() => setLocale(code)}>{LANGUAGE_NAMES[code]}</button>
          {/each}
        </div>
      </div>
      <hr />
      <button role="menuitem" class="item" onclick={() => pick(onfeedback)} disabled={!ui.online} title={ui.online ? undefined : t('settings.onlineOnly')}>
        {t('feedback.open')}
      </button>
      <button role="menuitem" class="item" onclick={() => pick(onprivacy)}>{t('privacy.open')}</button>
      <button role="menuitem" class="item" onclick={() => pick(onabout)}>{t('toolbar.about')}</button>
      <button role="menuitem" class="item" onclick={() => pick(onadmin)} disabled={!ui.online} title={ui.online ? undefined : t('settings.onlineOnly')}>
        {t('admin.menu')}
      </button>
      {#if !ui.online}<p class="note">{t('settings.onlineOnly')}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .settings {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    width: 270px;
    display: grid;
    gap: 10px;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .group {
    display: grid;
    gap: 4px;
  }
  .label {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .seg {
    display: flex;
  }
  .seg button {
    flex: 1;
    font-size: 0.8rem;
    padding: 4px 6px;
    border-radius: 0;
  }
  .seg button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .seg button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg button[aria-checked='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
    font-weight: 600;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0;
  }
  .item {
    text-align: left;
    border-color: transparent;
    background: transparent;
  }
  .item:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .note {
    margin: 0;
    font-size: 0.72rem;
    color: var(--muted);
  }
</style>
