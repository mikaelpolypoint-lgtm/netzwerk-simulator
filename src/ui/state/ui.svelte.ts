import type { Topology } from '../../core';

/**
 * Einstellungen der Oberfläche, die nicht zum Projekt gehören:
 * Basis- oder Pro-Modus und das angezeigte Stockwerk.
 */
export type Level = 'basic' | 'pro';

const LEVEL_KEY = 'netzwerk-simulator.level';

function load(): Level {
  try {
    return window.localStorage.getItem(LEVEL_KEY) === 'pro' ? 'pro' : 'basic';
  } catch {
    return 'basic';
  }
}

class Ui {
  level = $state<Level>(typeof window === 'undefined' ? 'basic' : load());
  /** Angezeigtes Stockwerk; "all" zeigt alle übereinander. */
  floor = $state<number | 'all'>('all');

  get pro() {
    return this.level === 'pro';
  }

  setLevel(level: Level) {
    this.level = level;
    try {
      window.localStorage.setItem(LEVEL_KEY, level);
    } catch {
      // Ohne Speicher gilt die Wahl bis zum Neuladen.
    }
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
