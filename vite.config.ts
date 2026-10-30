import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
// @ts-expect-error: reines JavaScript ohne Typdeklaration
import { thirdPartyLicenses } from './scripts/third-party-licenses.mjs';

// Nur im Build: Die Seite darf keinerlei Netzwerkverbindungen aufbauen
// (Datenschutz-Konzept, Abschnitt 7). Im Dev-Server würde das HMR blockieren.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

/**
 * Die Quell-HTML heisst dev.html, nicht index.html: Liegt das Repository auf
 * einem Webserver (z.B. Plesk), würde eine index.html im Hauptordner sonst als
 * Startseite ausgeliefert und lädt /src/main.ts, das es dort nicht gibt.
 * Im Build wird die Ausgabe wieder zu dist/index.html.
 */
function outputAsIndex(): Plugin {
  let outDir = 'dist';
  return {
    name: 'output-as-index',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const from = join(outDir, 'dev.html');
      if (existsSync(from)) renameSync(from, join(outDir, 'index.html'));
    },
  };
}

import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Eine einzige HTML-Datei, die auch per file:// (Variante A) funktioniert.
  plugins: [svelte(), viteSingleFile(), contentSecurityPolicy(), thirdPartyLicenses(), outputAsIndex()],
  build: { rollupOptions: { input: 'dev.html' } },
  server: { open: '/dev.html' },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
