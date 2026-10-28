import type { Topology } from '../../core';

/**
 * Einstellungen der Oberfläche, die nicht zum Projekt gehören:
 * Basis- oder Pro-Modus, Hell/Dunkel, das angezeigte Stockwerk und – in
 * der Webversion – was der Admin erlaubt.
 */
export type Level = 'basic' | 'pro';
export type Theme = 'auto' | 'light' | 'dark';
export type ModeName = 'design' | 'action' | 'doc';

/** Vom Admin freigegebene Funktionen (Webversion); lokal ist alles erlaubt. */
export interface Policy {
  modes: Record<ModeName, boolean>;
  pro: boolean;
  /** Sessions werden nach so vielen Stunden gelöscht. */
  sessionHours: number;
}

export const OPEN_POLICY: Policy = { modes: { design: true, action: true, doc: true }, pro: true, sessionHours: 24 };

const LEVEL_KEY = 'netzwerk-simulator.level';
const THEME_KEY = 'netzwerk-simulator.theme';

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ohne Speicher gilt die Wahl bis zum Neuladen.
  }
}

/** Läuft die Seite auf dem Server der Webversion? Der Server setzt dieses Meta-Tag. */
function detectServer(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="ns-server"]')?.getAttribute('content') === '1';
}

class Ui {
  #level = $state<Level>(read(LEVEL_KEY) === 'pro' ? 'pro' : 'basic');
  theme = $state<Theme>((['light', 'dark'] as const).find((t) => t === read(THEME_KEY)) ?? 'auto');
  /** Angezeigtes Stockwerk; "all" zeigt alle übereinander. */
  floor = $state<number | 'all'>('all');
  /** Webversion mit Server (Sessions, Rückmeldungen, Admin). */
  readonly online = detectServer();
  policy = $state.raw<Policy>(OPEN_POLICY);

  get level(): Level {
    return this.policy.pro ? this.#level : 'basic';
  }

  get pro() {
    return this.level === 'pro';
  }

  setLevel(level: Level) {
    if (level === 'pro' && !this.policy.pro) return;
    this.#level = level;
    write(LEVEL_KEY, level);
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    write(THEME_KEY, theme);
  }

  allowed(mode: ModeName): boolean {
    return this.policy.modes[mode];
  }
}

export const ui = new Ui();

/**
 * Nutzt das Projekt Funktionen des Pro-Modus? Dann schaltet die Oberfläche
 * beim Laden um, damit nichts versteckt bleibt, was im Netz wirkt.
 */
export function usesProFeatures(t: Topology): boolean {
  return t.devices.some(
    (d) =>
      d.type === 'l3switch' ||
      !!d.stp ||
      !!d.subinterfaces?.length ||
      !!d.portForwards?.length ||
      !!d.vlanNames?.length ||
      d.interfaces.some((i) => i.trunk || (i.vlan && i.vlan !== 1) || i.nat || i.dhcpRelay),
  );
}
