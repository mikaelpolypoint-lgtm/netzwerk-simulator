<script lang="ts">
  import { convert, type Medium, type SfpModule } from '../../core';
  import { t } from '../../i18n';
  import { SHOP_MIME } from '../dnd';
  import { itemHint, itemLabel, itemsOf, priceOf, type ShopItem } from '../shop';
  import { editor } from '../state/editor.svelte';
  import { shop } from '../state/shop.svelte';
  import { ui } from '../state/ui.svelte';
  import { TAG_HEX } from '../tags';
  import DeviceIcon from './DeviceIcon.svelte';
  import Icon from './Icon.svelte';

  /** Untermenü des Shops: Ausführungen der gewählten Kategorie mit Beschreibung und Preis. */
  const items = $derived(shop.category ? itemsOf(shop.category, (f) => ui.has(f)) : []);
  const SFP_COLOR: Record<SfpModule, string> = { '1G-SX': '#111827', '1G-LX': '#2563eb', '10G-SR': '#a8a29e', '10G-LR': '#1d4ed8' };
  const money = (chf: number) => `${ui.currency} ${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(convert(chf, ui.currency))}`;

  function ondragstart(event: DragEvent, item: ShopItem) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(SHOP_MIME, item.id);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && shop.category) {
      shop.close();
      event.stopPropagation();
    }
  }

  const active = (item: ShopItem) => item.kind === 'medium' && editor.tool === 'cable' && editor.medium === item.medium;
  const mediumClass = (m: Medium) => `sample sample-${m}`;
</script>

{#if shop.category}
  <div id="shop-flyout" class="flyout" role="dialog" tabindex="-1" aria-label={t(`shop.category.${shop.category}`)} {onkeydown}>
    <header>
      <h3>{t(`shop.category.${shop.category}`)}</h3>
      <button class="close" onclick={() => shop.close()} aria-label={t('about.close')}><Icon name="close" size={16} /></button>
    </header>
    <p class="hint">{t(`shop.category.${shop.category}.hint`)}</p>
    <ul>
      {#each items as item (item.id)}
        <li>
          <button
            class="item"
            class:active={active(item)}
            draggable={item.kind === 'device' || item.kind === 'area' || item.kind === 'sfp'}
            ondragstart={(e) => ondragstart(e, item)}
            onclick={() => shop.use(item)}
          >
            <span class="thumb">
              {#if item.kind === 'device'}
                <svg viewBox="-28 -24 56 48" width="44" height="38" aria-hidden="true" class="role-{item.type === 'router' || item.type === 'internet' || item.type === 'modem' ? 'routing' : item.type === 'switch' || item.type === 'l3switch' || item.type === 'accesspoint' ? 'distribution' : 'endpoint'}"><DeviceIcon type={item.type} variant={item.options?.variant} /></svg>
              {:else if item.kind === 'medium'}
                <svg viewBox="0 0 44 20" width="44" height="20" aria-hidden="true"><line class={mediumClass(item.medium)} x1="4" y1="10" x2="40" y2="10" /></svg>
              {:else if item.kind === 'sfp'}
                <svg viewBox="0 0 44 20" width="44" height="20" aria-hidden="true">
                  <rect x="4" y="5" width="28" height="10" rx="1.5" fill="#cbd5e1" stroke="#64748b" />
                  <rect x="32" y="4" width="8" height="12" rx="2" fill={SFP_COLOR[item.module]} />
                </svg>
              {:else}
                <svg viewBox="0 0 44 32" width="44" height="32" aria-hidden="true">
                  {#if item.preset.key === 'rack'}
                    <rect x="10" y="2" width="24" height="28" rx="2" fill="#111827" stroke="#475569" stroke-width="2" />
                    <path d="M14 9 H30 M14 15 H30 M14 21 H30" stroke="#64748b" stroke-width="2" />
                  {:else}
                    <rect x="3" y="4" width="38" height="24" rx="5" fill={TAG_HEX[item.preset.color]} fill-opacity="0.15" stroke={TAG_HEX[item.preset.color]} stroke-width="2" stroke-dasharray="5 3" />
                  {/if}
                </svg>
              {/if}
            </span>
            <span class="text">
              <span class="label">{itemLabel(item)}</span>
              <span class="desc">{itemHint(item)}</span>
            </span>
            {#if ui.has('tool.costs') && priceOf(item) > 0}
              <span class="price">{money(priceOf(item))}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}


<style>
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
  .flyout {
    position: absolute;
    top: 8px;
    left: calc(100% + 1px);
    z-index: 25;
    width: 300px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0 12px 12px 0;
    box-shadow: 8px 8px 24px rgb(0 0 0 / 0.14);
  }
  header {
    display: flex;
    align-items: center;
  }
  h3 {
    flex: 1;
    margin: 0;
    font-size: 0.95rem;
  }
  .close {
    border: none;
    background: none;
    color: var(--muted);
  }
  .flyout ul {
    display: grid;
    gap: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    border-radius: 9px;
    cursor: grab;
  }
  .item:hover,
  .item.active {
    border-color: var(--accent);
    background: var(--selected-soft);
  }
  .thumb {
    width: 44px;
    display: grid;
    place-items: center;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .label {
    display: block;
    font-weight: 600;
    font-size: 0.86rem;
  }
  .desc {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .price {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    white-space: nowrap;
  }
</style>
