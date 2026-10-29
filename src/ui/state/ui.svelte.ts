import type { Currency } from '../../core';
import { FEATURES, inLevel, isFeature, parseFeatureFile, PROFILE_LEVELS, serializeFeatureFile, type FeatureFile, type ProfileLevel } from '../features';

/**
 * Einstellungen der Oberfläche, die nicht zum Projekt gehören:
 * Funktionsumfang (Profil), Hell/Dunkel, das angezeigte Stockwerk,
 * Anzeigen (Adressen, Kosten) und – in der Webversion – was der Admin erlaubt.
 */
export type Theme = 'auto' | 'light' | 'dark';
export type ModeName = 'design' | 'simulation';

/** Vom Admin freigegebene Funktionen (Webversion); lokal ist alles erlaubt. */
export interface Policy {
  modes: Record<ModeName, boolean>;
  /** Höchstes Profil, das Lernende wählen können. */
  maxLevel: ProfileLevel;
  /** Profil für neue Besucherinnen und Besucher. */
  defaultLevel: ProfileLevel;
  /** Einzelne Funktionen, die immer aus sind. */
  disabled: string[];
  /** Sessions werden nach so vielen Stunden gelöscht. */
  sessionHours: number;
}

export const OPEN_POLICY: Policy = { modes: { design: true, simulation: true }, maxLevel: 5, defaultLevel: 2, disabled: [], sessionHours: 24 };

/** Ältere Server senden {modes: {design, action, doc}, pro}; das wird hier übersetzt. */
export function normalizePolicy(raw: unknown): Policy {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const modes = (typeof o.modes === 'object' && o.modes !== null ? o.modes : {}) as Record<string, unknown>;
  const level = (v: unknown, fallback: ProfileLevel): ProfileLevel => ((PROFILE_LEVELS as readonly unknown[]).includes(v) ? (v as ProfileLevel) : fallback);
  const maxLevel = level(o.maxLevel, o.pro === false ? 3 : 5);
  return {
    modes: { design: modes.design !== false, simulation: (modes.simulation ?? modes.action) !== false },
    maxLevel,
    defaultLevel: Math.min(level(o.defaultLevel, 2), maxLevel) as ProfileLevel,
    disabled: Array.isArray(o.disabled) ? o.disabled.filter((x): x is string => typeof x === 'string' && isFeature(x)) : [],
    sessionHours: typeof o.sessionHours === 'number' ? o.sessionHours : 24,
  };
}

const KEYS = {
  profile: 'netzwerk-simulator.profile',
  custom: 'netzwerk-simulator.features',
  theme: 'netzwerk-simulator.theme',
  addresses: 'netzwerk-simulator.addresses',
  currency: 'netzwerk-simulator.currency',
  oldLevel: 'netzwerk-simulator.level',
};

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Ohne Speicher gilt die Wahl bis zum Neuladen.
  }
}

/** Läuft die Seite auf dem Server der Webversion? Der Server setzt dieses Meta-Tag. */
function detectServer(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="ns-server"]')?.getAttribute('content') === '1';
}

interface StoredProfile {
  profile: ProfileLevel | 'custom';
  base: ProfileLevel;
  features: Record<string, boolean>;
  lock: boolean;
  title?: string;
}

function loadProfile(): StoredProfile | null {
  const stored = read(KEYS.custom);
  if (stored) {
    const file = parseFeatureFile(stored);
    if (file) return { profile: file.profile, base: file.base ?? 2, features: file.features ?? {}, lock: !!file.lock, ...(file.title ? { title: file.title } : {}) };
  }
  // Frühere Versionen kannten nur «Basis» und «Pro».
  const old = read(KEYS.oldLevel);
  if (old === 'pro') return { profile: 4, base: 4, features: {}, lock: false };
  if (old === 'basic') return { profile: 2, base: 2, features: {}, lock: false };
  return null;
}

class Ui {
  /** Webversion mit Server (Sessions, Rückmeldungen, Admin). */
  readonly online = detectServer();
  policy = $state.raw<Policy>(OPEN_POLICY);
  #profile = $state<StoredProfile>(loadProfile() ?? { profile: OPEN_POLICY.defaultLevel, base: OPEN_POLICY.defaultLevel, features: {}, lock: false });
  /** Wurde ein Profil gewählt (sonst gilt das Standardprofil des Admins)? */
  #chosen = loadProfile() !== null;
  theme = $state<Theme>((['light', 'dark'] as const).find((t) => t === read(KEYS.theme)) ?? 'auto');
  /** Angezeigtes Stockwerk; "all" zeigt alle übereinander. */
  floor = $state<number | 'all'>('all');
  /** IP-Adressen mit «privat/öffentlich» an den Geräten zeigen. */
  showAddresses = $state(read(KEYS.addresses) !== '0');
  currency = $state<Currency>((['EUR', 'USD'] as const).find((c) => c === read(KEYS.currency)) ?? 'CHF');

  /** Neue Regeln vom Server übernehmen; ohne eigene Wahl gilt das Standardprofil. */
  setPolicy(policy: Policy) {
    this.policy = policy;
    if (!this.#chosen) this.#profile = { ...this.#profile, profile: policy.defaultLevel, base: policy.defaultLevel };
  }

  get profile(): ProfileLevel | 'custom' {
    const p = this.#profile.profile;
    return p === 'custom' ? 'custom' : (Math.min(p, this.policy.maxLevel) as ProfileLevel);
  }

  get baseLevel(): ProfileLevel {
    const p = this.#profile;
    return Math.min(p.profile === 'custom' ? p.base : p.profile, this.policy.maxLevel) as ProfileLevel;
  }

  /** Von einer Lehrperson verteilte Auswahl, die nicht geändert werden kann. */
  get locked(): boolean {
    return this.#profile.lock;
  }

  get profileTitle(): string | undefined {
    return this.#profile.title;
  }

  /** Darf die Funktion vom Admin aus genutzt werden? */
  permitted(id: string): boolean {
    return !this.policy.disabled.includes(id) && inLevel(id, this.policy.maxLevel);
  }

  /** Ist die Funktion eingeschaltet? */
  has(id: string): boolean {
    if (!this.permitted(id)) return false;
    const p = this.#profile;
    if (p.profile === 'custom' && id in p.features) return p.features[id]!;
    return inLevel(id, this.baseLevel);
  }

  #store(next: StoredProfile) {
    this.#profile = next;
    this.#chosen = true;
    write(KEYS.custom, serializeFeatureFile({ profile: next.profile, base: next.base, features: next.features, ...(next.lock ? { lock: true } : {}), ...(next.title ? { title: next.title } : {}) }));
    write(KEYS.oldLevel, null);
  }

  setProfile(level: ProfileLevel) {
    if (this.locked) return;
    this.#store({ profile: Math.min(level, this.policy.maxLevel) as ProfileLevel, base: level, features: {}, lock: false });
  }

  setFeature(id: string, on: boolean) {
    if (this.locked || !this.permitted(id)) return;
    const base = this.baseLevel;
    const features = { ...(this.#profile.profile === 'custom' ? this.#profile.features : {}), [id]: on };
    // Was dem Profil entspricht, braucht keinen Eintrag.
    if (inLevel(id, base) === on) delete features[id];
    this.#store({ profile: Object.keys(features).length ? 'custom' : base, base, features, lock: false });
  }

  /**
   * Funktionen einschalten, die ein geladenes Projekt braucht.
   * Liefert die Funktionen, die der Admin sperrt (diese bleiben aus).
   */
  ensure(ids: string[]): { enabled: string[]; blocked: string[] } {
    const missing = ids.filter((id) => !this.has(id));
    const blocked = missing.filter((id) => !this.permitted(id) || this.locked);
    const enabled = missing.filter((id) => !blocked.includes(id));
    if (enabled.length) {
      const base = this.baseLevel;
      const features = { ...(this.#profile.profile === 'custom' ? this.#profile.features : {}) };
      for (const id of enabled) features[id] = true;
      this.#store({ profile: 'custom', base, features, lock: false });
    }
    return { enabled, blocked };
  }

  applyFile(text: string): FeatureFile | null {
    const file = parseFeatureFile(text);
    if (!file) return null;
    this.#store({ profile: file.profile, base: file.base ?? (file.profile === 'custom' ? 2 : file.profile), features: file.features ?? {}, lock: !!file.lock, ...(file.title ? { title: file.title } : {}) });
    return file;
  }

  /** Gesperrte Auswahl wieder freigeben (z.B. am Ende des Kurses). */
  unlock() {
    this.#store({ ...this.#profile, lock: false });
  }

  exportFile(options: { lock?: boolean; title?: string } = {}): string {
    const p = this.#profile;
    const features: Record<string, boolean> = {};
    for (const spec of FEATURES) if (this.has(spec.id) !== inLevel(spec.id, this.baseLevel)) features[spec.id] = this.has(spec.id);
    return serializeFeatureFile({
      profile: Object.keys(features).length ? 'custom' : this.baseLevel,
      base: this.baseLevel,
      ...(Object.keys(features).length ? { features } : {}),
      ...(options.lock ? { lock: true } : {}),
      ...(options.title ? { title: options.title } : p.title ? { title: p.title } : {}),
    });
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    write(KEYS.theme, theme);
  }

  setShowAddresses(on: boolean) {
    this.showAddresses = on;
    write(KEYS.addresses, on ? '1' : '0');
  }

  setCurrency(currency: Currency) {
    this.currency = currency;
    write(KEYS.currency, currency);
  }

  allowed(mode: ModeName): boolean {
    return this.policy.modes[mode];
  }
}

export const ui = new Ui();
