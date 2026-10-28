import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from './de.json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('Sprachdatei', () => {
  it('enthält jeden im Code fest verwendeten Schlüssel', () => {
    const missing = new Set<string>();
    let checked = 0;
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        checked++;
        if (!(match[1]! in de)) missing.add(`${match[1]} (${file})`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect([...missing]).toEqual([]);
  });
});
