<script lang="ts">
  import { addressScope, parseIp } from '../../core';
  import { t } from '../../i18n';

  /** Kleines Abzeichen: Adresse privat (RFC 1918), öffentlich, CGNAT (RFC 6598) oder speziell. */
  let { ip }: { ip: string } = $props();
  const scope = $derived.by(() => {
    const n = parseIp(ip);
    return n === null ? null : addressScope(n);
  });
</script>

{#if scope}
  <span class="scope scope-{scope}" title={t(`scope.${scope}.hint`)}>{t(`scope.${scope}`)}</span>
{/if}

<style>
  .scope {
    display: inline-block;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1.5;
    color: #fff;
    vertical-align: baseline;
  }
  .scope-private {
    background: #2563eb;
  }
  .scope-public {
    background: #16a34a;
  }
  .scope-cgnat {
    background: #d97706;
  }
  .scope-special {
    background: #6b7280;
  }
</style>
