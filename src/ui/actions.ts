import { parseProject, serializeProject, toPcapng } from '../core';
import { t } from '../i18n';
import { usedFeatures } from './features';
import { errorText, featureName } from './labels';
import { downloadText, projectFilename } from './persist/files';
import { editor } from './state/editor.svelte';
import { simStore } from './state/sim.svelte';
import { ui } from './state/ui.svelte';

/** Datei wählen lassen und als Text lesen (ohne Server, auch per file://). */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch {
        editor.notify(t('error.readFailed'), 'error');
        resolve(null);
      }
    };
    input.click();
  });
}

export function saveProject() {
  const filename = projectFilename();
  downloadText(filename, serializeProject(editor.topology, editor.tasks, editor.snapshots));
  editor.notify(t('status.saved', { file: filename }));
}

/** Funktionen einschalten, die das Projekt verwendet, und kurz darauf hinweisen. */
export function ensureProjectFeatures() {
  const { enabled, blocked } = ui.ensure(usedFeatures(editor.topology));
  if (enabled.length) editor.notify(t('features.autoEnabled', { list: enabled.map(featureName).join(', ') }));
  if (blocked.length) editor.notify(t('features.blocked', { list: blocked.map(featureName).join(', ') }), 'error');
}

export async function openProject() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const parsed = parseProject(file.text);
  if (!parsed.ok) {
    editor.notify(errorText(parsed.error), 'error');
    return;
  }
  if (editor.acting) editor.setMode('design');
  editor.replace(parsed.topology, { undoable: true, tasks: parsed.tasks ?? null, snapshots: parsed.snapshots ?? [] });
  ensureProjectFeatures();
  editor.notify(t(parsed.tasks ? 'status.loadedTask' : 'status.loaded', { file: file.name, title: parsed.tasks?.title ?? '' }));
}

/** Paketmitschnitt für Wireshark. */
export function exportPcap() {
  const sim = simStore.sim;
  const log = sim?.getPacketLog() ?? [];
  if (!sim || log.length === 0) {
    editor.notify(t('pcap.empty'), 'error');
    return;
  }
  const bytes = toPcapng(sim.topology, log);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = projectFilename().replace('.json', '.pcapng');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  editor.notify(t('pcap.saved', { count: log.length }));
}

export async function loadFeatureFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const applied = ui.applyFile(file.text);
  editor.notify(applied ? t('features.loaded', { title: applied.title ?? file.name }) : t('features.invalidFile'), applied ? 'info' : 'error');
}

export function saveFeatureFile(lock = false, title = '') {
  downloadText('funktionen.json', ui.exportFile({ lock, title }));
}
