import { DEVICE_SPECS, hasCli, type Medium } from '../core';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import { exportPcap, loadFeatureFile, openProject, saveProject } from './actions';
import { PROFILE_LEVELS } from './features';
import { SHOP_CATEGORIES, itemsOf, itemLabel, type ShopItem } from './shop';
import { openCli } from './state/cli.svelte';
import { openDesktop } from './state/desktop.svelte';
import { dialogs } from './state/dialogs.svelte';
import { editor } from './state/editor.svelte';
import { shop } from './state/shop.svelte';
import { simStore, type Speed } from './state/sim.svelte';
import { ui, type Theme } from './state/ui.svelte';

/**
 * Alle Befehle an einer Stelle: Menüleiste, Befehlssuche (Strg+K) und
 * Tastenkürzel verwenden dieselben Einträge.
 */
export interface Command {
  id: string;
  label: () => string;
  /** Tastenkürzel, z.B. "Mod+S", "Shift+Mod+Z", "F1", "K", "Space". Mod = Strg (macOS: ⌘). */
  keys?: string[];
  run: () => void;
  enabled?: () => boolean;
  visible?: () => boolean;
  /** Für Schalter und Auswahl: Häkchen im Menü. */
  checked?: () => boolean;
  icon?: string;
}

export type MenuEntry = { command: string } | { separator: true } | { submenu: () => string; entries: () => MenuEntry[]; visible?: () => boolean };

export interface Menu {
  id: string;
  label: () => string;
  entries: () => MenuEntry[];
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Tastenkürzel für die Anzeige, z.B. «Strg+S» oder «⌘S». */
export function keyLabel(keys: string): string {
  return keys
    .split('+')
    .map((k) => (k === 'Mod' ? (isMac ? '⌘' : t('key.ctrl')) : k === 'Shift' ? (isMac ? '⇧' : t('key.shift')) : k === 'Alt' ? (isMac ? '⌥' : 'Alt') : k === 'Delete' ? t('key.delete') : k === 'Space' ? t('key.space') : k))
    .join(isMac ? '' : '+');
}

const selectedDevice = () => editor.selectedDevice;
const design = () => editor.editable;
const simulation = () => editor.acting;

function chooseMedium(medium: Medium) {
  editor.medium = medium;
  if (editor.acting) editor.setMode('design');
  editor.setTool('cable');
}

const COMMANDS: Command[] = [
  // Datei
  { id: 'file.new', label: () => t('menu.file.new'), keys: ['Alt+N'], run: () => editor.clear(), icon: 'plus' },
  { id: 'file.open', label: () => t('menu.file.open'), keys: ['Mod+O'], run: () => void openProject() },
  { id: 'file.save', label: () => t('menu.file.save'), keys: ['Mod+S'], run: saveProject, icon: 'download' },
  { id: 'file.pcap', label: () => t('menu.file.pcap'), run: exportPcap, visible: () => ui.has('tool.pcap'), enabled: () => (simStore.sim?.getPacketLog().length ?? 0) > 0 },
  { id: 'file.snapshots', label: () => t('menu.file.snapshots'), keys: ['Shift+Mod+S'], run: () => dialogs.show('snapshots'), visible: () => ui.has('tool.snapshots'), icon: 'snapshot' },
  { id: 'file.session', label: () => t('menu.file.session'), run: () => dialogs.show('session'), visible: () => ui.online },

  // Bearbeiten
  { id: 'edit.undo', label: () => t('menu.edit.undo'), keys: ['Mod+Z'], run: () => editor.undo(), enabled: () => editor.canUndo, icon: 'undo' },
  { id: 'edit.redo', label: () => t('menu.edit.redo'), keys: ['Mod+Y', 'Shift+Mod+Z'], run: () => editor.redo(), enabled: () => editor.canRedo, icon: 'redo' },
  { id: 'edit.copy', label: () => t('menu.edit.copy'), keys: ['Mod+C'], run: () => editor.copyArea(), enabled: () => editor.selection?.kind === 'area' },
  { id: 'edit.paste', label: () => t('menu.edit.paste'), keys: ['Mod+V'], run: () => editor.pasteArea(), enabled: () => editor.canPaste },
  { id: 'edit.duplicate', label: () => t('menu.edit.duplicate'), keys: ['Mod+D'], run: () => editor.duplicateSelection(), enabled: () => design() && (editor.selection?.kind === 'area' || !!selectedDevice()) },
  { id: 'edit.rename', label: () => t('menu.edit.rename'), keys: ['F2'], run: () => document.getElementById('inspector-name')?.focus(), enabled: () => !!selectedDevice() && design() },
  { id: 'edit.delete', label: () => t('menu.edit.delete'), keys: ['Delete', 'Backspace'], run: () => editor.deleteSelection(), enabled: () => design() && !!editor.selection, icon: 'trash' },
  { id: 'edit.select', label: () => t('menu.edit.select'), keys: ['V'], run: () => editor.setTool('select'), checked: () => editor.tool === 'select', icon: 'pointer' },
  { id: 'edit.cable', label: () => t('menu.edit.cable'), keys: ['K'], run: () => editor.setTool(editor.tool === 'cable' ? 'select' : 'cable'), enabled: design, checked: () => editor.tool === 'cable', icon: 'cable' },
  { id: 'edit.area', label: () => t('menu.edit.area'), keys: ['B'], run: () => editor.setTool(editor.tool === 'area' ? 'select' : 'area'), enabled: design, visible: () => ui.has('tool.areas'), checked: () => editor.tool === 'area', icon: 'area' },
  { id: 'edit.cancel', label: () => t('menu.edit.cancel'), keys: ['Escape'], run: () => editor.cancel() },

  // Ansicht
  { id: 'view.zoomIn', label: () => t('menu.view.zoomIn'), keys: ['+', '='], run: () => editor.zoomAt(1.2), icon: 'zoomIn' },
  { id: 'view.zoomOut', label: () => t('menu.view.zoomOut'), keys: ['-'], run: () => editor.zoomAt(1 / 1.2), icon: 'zoomOut' },
  { id: 'view.fit', label: () => t('menu.view.fit'), keys: ['0'], run: () => editor.fit(), icon: 'fit' },
  { id: 'view.center', label: () => t('menu.view.center'), keys: ['C'], run: () => editor.centerSelection(), enabled: () => !!editor.selection, icon: 'center' },
  { id: 'view.rack', label: () => t('menu.view.rack'), keys: ['R'], run: () => dialogs.show('rack'), visible: () => ui.has('tool.racks'), icon: 'rack' },
  { id: 'view.addresses', label: () => t('menu.view.addresses'), keys: ['A'], run: () => ui.setShowAddresses(!ui.showAddresses), checked: () => ui.showAddresses, visible: () => ui.has('tool.addressBadges') },
  { id: 'view.costs', label: () => t('menu.view.costs'), run: () => dialogs.show('costs'), visible: () => ui.has('tool.costs'), icon: 'coins' },

  // Simulation
  { id: 'sim.toggle', label: () => t('menu.sim.toggle'), keys: ['M', 'F5'], run: () => editor.setMode(editor.acting ? 'design' : 'simulation'), checked: design, enabled: () => ui.allowed('design') && ui.allowed('simulation') },
  { id: 'sim.pause', label: () => (simStore.paused ? t('sim.resume') : t('sim.pause')), keys: ['Space'], run: () => simStore.togglePause(), enabled: simulation, icon: 'pause' },
  { id: 'sim.step', label: () => t('sim.step'), keys: ['N'], run: () => simStore.step(), enabled: simulation, icon: 'step' },
  { id: 'sim.clear', label: () => t('packets.clear'), run: () => simStore.clearPacketLog(), enabled: simulation, visible: () => ui.has('tool.sniffer') },
  {
    id: 'sim.desktop',
    label: () => t('menu.sim.desktop'),
    keys: ['D'],
    run: () => {
      const d = selectedDevice();
      if (d) openDesktop(d.id);
    },
    enabled: () => simulation() && !!selectedDevice() && DEVICE_SPECS[selectedDevice()!.type].role === 'endpoint',
    icon: 'desktop',
  },
  {
    id: 'sim.cli',
    label: () => t('cli.open'),
    keys: ['T'],
    run: () => {
      const d = selectedDevice();
      if (d) openCli(d.id);
    },
    enabled: () => !!selectedDevice() && hasCli(selectedDevice()!.type),
    visible: () => ui.has('net.cli'),
    icon: 'terminal',
  },

  // Werkzeuge
  { id: 'tool.ipcalc', label: () => t('menu.tool.ipcalc'), keys: ['I'], run: () => dialogs.ipCalculator(), visible: () => ui.has('tool.ipCalculator'), icon: 'calc' },
  { id: 'tool.vlans', label: () => t('menu.tool.vlans'), run: () => dialogs.show('vlans'), visible: () => ui.has('net.vlan'), icon: 'tag' },
  { id: 'tool.catalog', label: () => t('catalog.open'), run: () => dialogs.show('catalog'), icon: 'star' },
  { id: 'tool.taskEditor', label: () => t('menu.tool.taskEditor'), run: () => dialogs.show('taskEditor'), visible: () => ui.has('tool.taskEditor'), enabled: design },
  { id: 'tool.review', label: () => t('menu.tool.review'), run: () => dialogs.show('review'), visible: () => ui.has('tool.taskEditor') },
  { id: 'tool.features', label: () => t('menu.tool.features'), run: () => dialogs.show('features'), icon: 'layers' },
  { id: 'tool.loadFeatures', label: () => t('menu.tool.loadFeatures'), run: () => void loadFeatureFile(), enabled: () => !ui.locked },
  { id: 'tool.admin', label: () => t('admin.menu'), run: () => dialogs.show('admin'), visible: () => ui.online, icon: 'lock' },

  // Hilfe
  { id: 'help.help', label: () => t('menu.help.help'), keys: ['F1'], run: () => dialogs.showHelp(helpTopicFor()), icon: 'help' },
  { id: 'help.palette', label: () => t('menu.help.palette'), keys: ['Mod+K'], run: () => dialogs.show('palette'), icon: 'search' },
  { id: 'help.shortcuts', label: () => t('menu.help.shortcuts'), keys: ['?'], run: () => dialogs.show('shortcuts') },
  { id: 'help.guide', label: () => t('menu.help.guide'), run: () => dialogs.showHelp('overview'), icon: 'book' },
  { id: 'help.privacy', label: () => t('privacy.open'), run: () => dialogs.show('privacy') },
  { id: 'help.feedback', label: () => t('feedback.open'), run: () => dialogs.show('feedback'), visible: () => ui.online },
  { id: 'help.about', label: () => t('toolbar.about'), run: () => dialogs.show('about') },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): Command | undefined {
  return byId.get(id);
}

export function allCommands(): Command[] {
  return COMMANDS.filter((c) => c.visible?.() ?? true);
}

/** Passendes Hilfethema zur Auswahl (F1 ist kontextbezogen). */
export function helpTopicFor(): string {
  const focused = typeof document !== 'undefined' ? document.activeElement?.closest('[data-help]')?.getAttribute('data-help') : null;
  if (focused) return focused;
  const device = editor.selectedDevice;
  if (device) return `device.${device.type}`;
  if (editor.selectedCable) return 'cables';
  if (editor.selectedArea) return 'areas';
  return editor.acting ? 'simulation' : 'overview';
}

// --- Dynamische Befehle (Shop, Auswahlen) ------------------------------------------

function dynamic(id: string, label: () => string, run: () => void, extra: Partial<Command> = {}): MenuEntry {
  if (!byId.has(id)) {
    const c: Command = { id, label, run, ...extra };
    byId.set(id, c);
  }
  return { command: id };
}

function shopEntry(item: ShopItem): MenuEntry {
  return dynamic(`insert.${item.id}`, () => itemLabel(item), () => shop.use(item), { enabled: design });
}

const THEMES: Theme[] = ['auto', 'light', 'dark'];
const LANGUAGE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };
const SPEEDS: Speed[] = ['realtime', 'slow', 'slower'];

export const MENUS: Menu[] = [
  {
    id: 'file',
    label: () => t('menu.file'),
    entries: () => [
      { command: 'file.new' },
      { command: 'file.open' },
      { command: 'file.save' },
      { separator: true },
      { command: 'file.snapshots' },
      { command: 'file.pcap' },
      { command: 'file.session' },
    ],
  },
  {
    id: 'edit',
    label: () => t('menu.edit'),
    entries: () => [
      { command: 'edit.undo' },
      { command: 'edit.redo' },
      { separator: true },
      { command: 'edit.copy' },
      { command: 'edit.paste' },
      { command: 'edit.duplicate' },
      { command: 'edit.rename' },
      { command: 'edit.delete' },
      { separator: true },
      { command: 'edit.select' },
      { command: 'edit.cable' },
      { command: 'edit.area' },
    ],
  },
  {
    id: 'insert',
    label: () => t('menu.insert'),
    entries: () =>
      SHOP_CATEGORIES.map((category) => ({
        submenu: () => t(`shop.category.${category}`),
        entries: () => itemsOf(category, (f) => ui.has(f)).map(shopEntry),
        visible: () => itemsOf(category, (f) => ui.has(f)).length > 0,
      })),
  },
  {
    id: 'view',
    label: () => t('menu.view'),
    entries: () => [
      { command: 'view.zoomIn' },
      { command: 'view.zoomOut' },
      { command: 'view.fit' },
      { command: 'view.center' },
      { separator: true },
      { command: 'view.addresses' },
      { command: 'view.rack' },
      { command: 'view.costs' },
      { separator: true },
      {
        submenu: () => t('menu.view.profile'),
        entries: () => [
          ...PROFILE_LEVELS.filter((l) => l <= ui.policy.maxLevel).map((level) =>
            dynamic(`profile.${level}`, () => t(`profile.${level}`), () => ui.setProfile(level), { checked: () => ui.profile === level, enabled: () => !ui.locked }),
          ),
          { separator: true } as MenuEntry,
          { command: 'tool.features' },
        ],
      },
      {
        submenu: () => t('settings.theme'),
        entries: () => THEMES.map((theme) => dynamic(`theme.${theme}`, () => t(`settings.theme.${theme}`), () => ui.setTheme(theme), { checked: () => ui.theme === theme })),
      },
      {
        submenu: () => t('toolbar.language'),
        entries: () => LOCALES.map((code) => dynamic(`lang.${code}`, () => LANGUAGE_NAMES[code], () => setLocale(code), { checked: () => locale() === code })),
      },
    ],
  },
  {
    id: 'simulation',
    label: () => t('menu.simulation'),
    entries: () => [
      dynamic('sim.toDesign', () => t('mode.design'), () => editor.setMode('design'), { checked: design, enabled: () => ui.allowed('design') }),
      dynamic('sim.toSimulation', () => t('mode.simulation'), () => editor.setMode('simulation'), { checked: simulation, enabled: () => ui.allowed('simulation') }),
      { separator: true },
      { command: 'sim.pause' },
      { command: 'sim.step' },
      {
        submenu: () => t('sim.speed'),
        entries: () => SPEEDS.map((speed) => dynamic(`speed.${speed}`, () => t(`sim.speed.${speed}`), () => (simStore.speed = speed), { checked: () => simStore.speed === speed })),
      },
      { separator: true },
      { command: 'sim.desktop' },
      { command: 'sim.cli' },
      { command: 'sim.clear' },
      { command: 'file.pcap' },
    ],
  },
  {
    id: 'tools',
    label: () => t('menu.tools'),
    entries: () => [
      { command: 'tool.ipcalc' },
      { command: 'tool.vlans' },
      { separator: true },
      { command: 'tool.catalog' },
      { command: 'tool.taskEditor' },
      { command: 'tool.review' },
      { separator: true },
      { command: 'tool.features' },
      { command: 'tool.loadFeatures' },
      { command: 'tool.admin' },
    ],
  },
  {
    id: 'help',
    label: () => t('menu.help'),
    entries: () => [
      { command: 'help.help' },
      { command: 'help.guide' },
      { command: 'help.shortcuts' },
      { command: 'help.palette' },
      { separator: true },
      { command: 'help.privacy' },
      { command: 'help.feedback' },
      { command: 'help.about' },
    ],
  },
];

export const mediaCommands = (medium: Medium) => chooseMedium(medium);

// --- Tastenkürzel ---------------------------------------------------------------

function matches(binding: string, event: KeyboardEvent): boolean {
  const parts = binding.split('+');
  const key = parts.pop()!;
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if (mod !== (event.ctrlKey || event.metaKey) || alt !== event.altKey) return false;
  // Zeichen wie «?» oder «+» entstehen je nach Tastatur mit Shift; dort Shift nicht prüfen.
  const printable = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (!printable && shift !== event.shiftKey) return false;
  if (key === 'Space') return event.key === ' ';
  return event.key.toLowerCase() === key.toLowerCase();
}

/** Tastendruck einem Befehl zuordnen; true = erledigt. */
export function handleShortcut(event: KeyboardEvent): boolean {
  const inField = !!(event.target as Element | null)?.closest('input, textarea, select, [contenteditable], .cli-input');
  for (const c of COMMANDS) {
    if (!c.keys) continue;
    for (const binding of c.keys) {
      const plain = !binding.includes('Mod') && !binding.startsWith('F') && binding !== 'Escape';
      if (inField && plain) continue;
      if (!matches(binding, event)) continue;
      if (c.visible && !c.visible()) return false;
      if (c.enabled && !c.enabled()) return false;
      c.run();
      return true;
    }
  }
  return false;
}
