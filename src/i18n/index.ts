import de from './de.json';

type Params = Record<string, string | number>;

// Weitere Sprachen (fr, it, en) als JSON-Datei mit denselben Schlüsseln ergänzen.
const dictionaries: Record<string, Record<string, string>> = { de };
const locale = 'de';

export function t(key: string, params?: Params): string {
  const text = dictionaries[locale]?.[key] ?? de[key as keyof typeof de] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
