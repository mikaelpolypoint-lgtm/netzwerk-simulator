import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../core/sim/commands';
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

  it('übersetzt jede Ausgabe der simulierten Anwendungen', () => {
    const missing = new Set<string>();
    let checked = 0;
    for (const file of sourceFiles(join(__dirname, '../core'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:print|#step|#fail|#report|report)\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        checked++;
        if (!(`console.${match[1]}` in de)) missing.add(`console.${match[1]} (${file})`);
      }
    }
    // Zusammengesetzte Codes: ping.${error}, help.${befehl}, ipconfig.mode.${modus}
    const sendErrors = ['noRoute', 'hostUnreachable', 'gatewayUnreachable'];
    const dnsErrors = ['noDnsServer', 'timeout', ...sendErrors];
    const dynamic = [
      ...sendErrors.map((e) => `console.ping.${e}`),
      ...COMMANDS.map((c) => `console.help.${c}`),
      'console.ipconfig.mode.static',
      'console.ipconfig.mode.dhcp',
      ...['ping', 'tracert'].flatMap((c) => [`console.${c}.unknownHost`, ...dnsErrors.map((e) => `console.${c}.dns.${e}`)]),
      ...['invalidName', 'nxdomain', ...dnsErrors].map((e) => `console.browser.dns.${e}`),
      ...['refused', 'timeout', 'reset', ...sendErrors].map((e) => `console.browser.tcp.${e}`),
      'console.browser.invalidUrl',
      'console.browser.httpsUnsupported',
      ...dnsErrors.concat('invalidName', 'nxdomain').map((e) => `console.mail.dns.${e}`),
      ...['refused', 'timeout', 'reset', ...sendErrors].map((e) => `console.mail.tcp.${e}`),
    ];
    // Gründe der Aufgabenprüfung
    const reasons = readFileSync(join(__dirname, '../core/tasks/tasks.ts'), 'utf8').matchAll(/fail\(id, '([a-zA-Z]+)'/g);
    for (const [, code] of reasons) if (!(`tasks.reason.${code}` in de)) missing.add(`tasks.reason.${code}`);
    for (const key of dynamic) if (!(key in de)) missing.add(key);
    expect(checked).toBeGreaterThan(30);
    expect([...missing]).toEqual([]);
  });
});
