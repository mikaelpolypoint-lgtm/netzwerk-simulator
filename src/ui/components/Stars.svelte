<script lang="ts">
  import { t } from '../../i18n';

  /** Schwierigkeit als 1 bis 5 Sterne. */
  let { n }: { n: number } = $props();
</script>

<span class="stars" role="img" aria-label={t('catalog.stars', { n })} title={t('catalog.stars', { n })}>
  {#each [1, 2, 3, 4, 5] as i (i)}<span class:on={i <= n}>★</span>{/each}
</span>

<style>
  .stars {
    letter-spacing: 1px;
    white-space: nowrap;
  }
  span span {
    color: var(--border);
  }
  span span.on {
    color: #f59e0b;
  }
</style>
