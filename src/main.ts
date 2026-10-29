import { mount } from 'svelte';
import App from './ui/App.svelte';
import './ui/app.css';

const target = document.getElementById('app')!;
const boot = document.getElementById('boot');
try {
  // Hinweis «wird geladen» erst nach erfolgreichem Start entfernen; bei einem Fehler bleibt er mit der Meldung stehen.
  boot?.remove();
  mount(App, { target });
} catch (error) {
  if (boot) target.prepend(boot);
  const box = document.getElementById('boot-error');
  if (box) box.textContent += `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
  throw error;
}
