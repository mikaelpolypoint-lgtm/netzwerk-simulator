import de from './de.json';
import fr from './fr.json';

type Params = Record<string, string | number>;

// Weitere Sprachen (it, en) als JSON-Datei mit denselben Schlüsseln ergänzen
// und hier eintragen; ein Test prüft, dass keine Schlüssel fehlen.
const dictionaries = { de, fr } as Record<string, Record<string, string>>;
export const LOCALES = ['de', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = 'netzwerk-simulator.locale';
// Ausserhalb des Browsers (Tests) gibt es keinen Speicher.
const storage = () => (typeof window === 'undefined' ? undefined : window.localStorage);

function initialLocale(): Locale {
  try {
    const stored = storage()?.getItem(STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    // Gesperrter Speicher (z.B. privates Fenster): dann gilt die Browsersprache.
  }
  return (typeof navigator === 'undefined' ? '' : navigator.language).toLowerCase().startsWith('fr') ? 'fr' : 'de';
}

// Reaktiv: Wechselt die Sprache, zeichnet Svelte alle Texte neu.
const state = $state({ locale: initialLocale() });

export function locale(): Locale {
  return state.locale;
}

export function setLocale(next: Locale) {
  state.locale = next;
  try {
    storage()?.setItem(STORAGE_KEY, next);
  } catch {
    // Nicht speicherbar: gilt dann nur bis zum Neuladen.
  }
}

export function t(key: string, params?: Params): string {
  const text = dictionaries[state.locale]?.[key] ?? de[key as keyof typeof de] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
