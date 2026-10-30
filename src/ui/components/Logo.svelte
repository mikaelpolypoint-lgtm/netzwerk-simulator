<script lang="ts" module>
  // Logo und Symbol aus branding/ (Name und Logo sind nicht Teil der AGPL, siehe NOTICE.md).
  import wordmark from '../../../branding/leyoNET.svg?raw';
  import mark from '../../../branding/favicon.svg?raw';

  /** Schwarz wird zu currentColor, damit das Logo im dunklen Design lesbar bleibt; Titel und Grösse kommen vom Aufrufer. */
  function prepare(svg: string): string {
    return svg
      .replace(/<\?xml[^>]*>/, '')
      .replace(/<title[^>]*>.*?<\/title>/s, '')
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\srole="img"|\saria-labelledby="[^"]*"/g, '')
      .replace(/#000000/gi, 'currentColor')
      .replace('<svg', '<svg aria-hidden="true" focusable="false"');
  }
  const WORDMARK = prepare(wordmark);
  // Im Symbol bleibt der weisse Hintergrund nur im hellen Design sichtbar.
  const MARK = prepare(mark).replace(/fill="#ffffff"/i, 'fill="var(--logo-bg, #ffffff)"');
</script>

<script lang="ts">
  let { variant = 'wordmark', height = 24, label = 'leyoNET' }: { variant?: 'wordmark' | 'mark'; height?: number; label?: string } = $props();
</script>

<span class="logo" role="img" aria-label={label} style:height="{height}px" style:--ratio={variant === 'mark' ? 1 : 620 / 180}>
  {@html variant === 'mark' ? MARK : WORDMARK}
</span>

<style>
  .logo {
    display: inline-block;
    aspect-ratio: var(--ratio);
    line-height: 0;
    vertical-align: middle;
  }
  .logo :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
