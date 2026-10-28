import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';
import { setLocale, t } from './index';

const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

describe('Übersetzungen', () => {
  it.each([['en', en as Record<string, string>]])('%s hat dieselben Schlüssel und Platzhalter wie de', (_, dict) => {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(de).sort());
    for (const [key, text] of Object.entries(de)) expect([key, placeholders(dict[key]!)]).toEqual([key, placeholders(text)]);
  });

  it('wechselt die Sprache zur Laufzeit', () => {
    setLocale('en');
    expect(t('toolbar.save')).toBe('Save');
    setLocale('de');
    expect(t('toolbar.save')).toBe('Speichern');
  });
});
