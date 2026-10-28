<script lang="ts">
  import { DEVICE_SPECS, DEVICE_TYPES, type DeviceType } from '../../core';
  import { t } from '../../i18n';
  import { DEVICE_MIME } from '../dnd';
  import { roleLabel, typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import DeviceIcon from './DeviceIcon.svelte';

  function ondragstart(event: DragEvent, type: DeviceType) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(DEVICE_MIME, type);
    event.dataTransfer.effectAllowed = 'copy';
  }
</script>

<nav class="palette" aria-labelledby="palette-title">
  <h2 id="palette-title">{t('palette.title')}</h2>
  <p class="hint">{t('palette.hint')}</p>
  <ul>
    {#each DEVICE_TYPES as type (type)}
      <li>
        <button
          class="role-{DEVICE_SPECS[type].role}"
          draggable={editor.editable}
          disabled={!editor.editable}
          onclick={() => editor.addDeviceAtCenter(type)}
          ondragstart={(e) => ondragstart(e, type)}
        >
          <svg viewBox="-28 -24 56 48" width="44" height="38" aria-hidden="true">
            <DeviceIcon {type} />
          </svg>
          <span>
            <span class="name">{typeLabel(type)}</span>
            <span class="role">{roleLabel(type)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .palette {
    padding: 12px;
    overflow-y: auto;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 0.95rem;
  }
  .hint {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 0.8rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: grab;
  }
  button:hover:not(:disabled) {
    border-color: var(--role);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  button > span {
    min-width: 0;
  }
  .name {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .role {
    display: block;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
