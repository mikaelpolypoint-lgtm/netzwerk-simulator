import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

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

export default defineConfig({
  // Eine einzige HTML-Datei, die auch per file:// (Variante A) funktioniert.
  plugins: [svelte(), viteSingleFile(), contentSecurityPolicy()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
