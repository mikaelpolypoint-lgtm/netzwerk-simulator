<script lang="ts">
  import { editor } from '../state/editor.svelte';

  const message = $derived(editor.message);

  $effect(() => {
    if (!message) return;
    const id = message.id;
    const timer = setTimeout(() => editor.dismissMessage(id), message.kind === 'error' ? 6000 : 3500);
    return () => clearTimeout(timer);
  });
</script>

<!-- Die Region bleibt immer im DOM, damit Screenreader neue Meldungen ansagen. -->
<div class="toast-region" aria-live="polite">
  {#if message}
    {#key message.id}
      <p class="toast" class:error={message.kind === 'error'}>{message.text}</p>
    {/key}
  {/if}
</div>

<style>
  .toast-region {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    max-width: min(560px, calc(100vw - 32px));
    pointer-events: none;
    z-index: 10;
  }
  .toast {
    margin: 0;
    padding: 10px 16px;
    border-radius: 8px;
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow);
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
</style>
