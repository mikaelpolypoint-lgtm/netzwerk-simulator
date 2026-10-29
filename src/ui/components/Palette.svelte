<script lang="ts">
  import type { DeviceType } from '../../core';
  import { t } from '../../i18n';
  import { SHOP_CATEGORIES, itemsOf, type ShopCategory } from '../shop';
  import { editor } from '../state/editor.svelte';
  import { shop } from '../state/shop.svelte';
  import { ui } from '../state/ui.svelte';
  import DeviceIcon from './DeviceIcon.svelte';
  import Icon from './Icon.svelte';

  /**
   * Palette als «Shop»: Zuerst die Art wählen (Endgeräte, Switches, Router …),
   * dann im Untermenü die Ausführung. Klicken setzt in die Bildmitte, Ziehen
   * an eine bestimmte Stelle. Preise erscheinen, wenn die Kosten eingeschaltet sind.
   */
  const categories = $derived(SHOP_CATEGORIES.filter((c) => itemsOf(c, (f) => ui.has(f)).length > 0));
  const CATEGORY_ICON: Record<ShopCategory, { type?: DeviceType; icon?: string }> = {
    endpoints: { type: 'pc' },
    servers: { type: 'server' },
    switches: { type: 'switch' },
    routers: { type: 'router' },
    wireless: { type: 'accesspoint' },
    internet: { type: 'internet' },
    links: { icon: 'cable' },
    modules: { icon: 'plus' },
    areas: { icon: 'area' },
  };

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && shop.category) {
      shop.close();
      event.stopPropagation();
    }
  }

  const roleOf = (category: ShopCategory) =>
    category === 'endpoints' || category === 'servers' ? 'endpoint' : category === 'routers' || category === 'internet' ? 'routing' : category === 'links' || category === 'modules' || category === 'areas' ? 'tool' : 'distribution';
</script>

<!-- Tastatursteuerung für die enthaltenen Schaltflächen (Pfeiltasten, Escape). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="palette" aria-labelledby="palette-title" {onkeydown} data-help="shop">
  <h2 id="palette-title">{t('palette.title')}</h2>
  <p class="hint">{t('palette.hint')}</p>
  <ul class="categories">
    {#each categories as category (category)}
      <li>
        <button
          class="category"
          aria-expanded={shop.category === category}
          aria-controls="shop-flyout"
          disabled={!editor.editable}
          onclick={() => shop.toggle(category)}
          title={t(`shop.category.${category}.hint`)}
        >
          <span class="ico role-{roleOf(category)}">
            {#if CATEGORY_ICON[category].type}
              <svg viewBox="-28 -24 56 48" width="38" height="32" aria-hidden="true"><DeviceIcon type={CATEGORY_ICON[category].type!} /></svg>
            {:else}
              <Icon name={CATEGORY_ICON[category].icon!} size={24} />
            {/if}
          </span>
          <span class="name">{t(`shop.category.${category}`)}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if !editor.editable}
    <p class="hint">{t('palette.simulationHint')}</p>
  {/if}
</nav>

<style>
  .palette {
    padding: 12px;
  }
  h2 {
    margin: 0 0 2px;
    font-size: 0.95rem;
  }
  .hint {
    margin: 0 0 10px;
    color: var(--muted);
    font-size: 0.78rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .categories {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .category {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 8px 4px 6px;
    border-radius: 10px;
    background: var(--surface);
  }
  .category[aria-expanded='true'] {
    border-color: var(--accent);
    background: var(--selected-soft);
  }
  .category:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .category:disabled {
    opacity: 0.45;
  }
  .ico {
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .category .name {
    font-size: 0.75rem;
    font-weight: 600;
    text-align: center;
  }
  :global(.sample) {
    stroke-width: 3;
    stroke-linecap: round;
  }
  :global(.sample-tp) {
    stroke: var(--cable);
  }
  :global(.sample-fiber) {
    stroke: #ef6c00;
    stroke-width: 4;
  }
  :global(.sample-wireless) {
    stroke: #2563eb;
    stroke-dasharray: 1 6;
  }
  :global(.sample-serial) {
    stroke: #be123c;
    stroke-dasharray: 8 3 2 3;
  }
  :global(.sample-coax) {
    stroke: #0f766e;
    stroke-width: 5;
  }
  :global(.sample-dsl) {
    stroke: #a16207;
    stroke-dasharray: 6 3;
  }
  :global(.sample-cellular) {
    stroke: #7c3aed;
    stroke-dasharray: 2 4;
  }
</style>
