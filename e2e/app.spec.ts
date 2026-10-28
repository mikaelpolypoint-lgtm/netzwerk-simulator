import { expect, test, type Page } from '@playwright/test';

const example = (name: string) => `docs/beispiele/${name}.json`;
const task = (name: string) => `docs/aufgaben/${name}.json`;

/** Öffnet ein Projekt über «Öffnen …» (verstecktes Dateifeld der Werkzeugleiste). */
async function openProject(page: Page, file: string) {
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.locator('.toast').last()).toContainText('geladen');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('lädt ohne eine einzige Netzwerkanfrage ausser der Seite selbst', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Netzwerk-Simulator' })).toBeVisible();
  expect(requests).toEqual(['http://localhost:4174/']);
});

test('Gerät hinzufügen und rückgängig machen', async ({ page }) => {
  await page.locator('.palette').getByRole('button', { name: /^Rechner/ }).click();
  const pc = page.getByRole('button', { name: 'PC 1, Rechner' });
  await expect(pc).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(pc).toHaveCount(0);
});

test('Ping über einen Router im Aktionsmodus', async ({ page }) => {
  await openProject(page, example('zwei-subnetze'));
  await page.getByRole('radio', { name: 'Aktionsmodus' }).click();
  await page.getByRole('button', { name: 'PC 1, Rechner' }).click();
  await page.getByRole('button', { name: 'Desktop öffnen' }).click();
  const input = page.getByLabel('Befehl eingeben');
  await input.fill('ping 192.168.2.10');
  await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Antwort von 192.168.2.10', { timeout: 15_000 });
  await expect(page.locator('.packets tbody')).toContainText('ICMP');
});

test('Aufgabe prüfen', async ({ page }) => {
  await openProject(page, task('zwei-subnetze-loesung'));
  await page.getByRole('button', { name: 'Prüfen' }).click();
  // Das letzte Ziel verlangt einen selbst gesendeten Ping.
  await expect(page.getByRole('status').filter({ hasText: 'Zielen erfüllt' })).toHaveText('8 von 9 Zielen erfüllt.');
});

test('Abgaben mehrerer Lernender auswerten', async ({ page }) => {
  await page.getByRole('button', { name: 'Abgaben auswerten …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abgaben auswerten' });
  await dialog.locator('input[type=file]').setInputFiles([task('zwei-subnetze-loesung'), task('zwei-subnetze')]);
  await expect(dialog.getByRole('row', { name: /zwei-subnetze-loesung\.json/ })).toContainText('8/8');
  await expect(dialog.getByRole('row', { name: /^zwei-subnetze\.json/ })).toContainText('0/8');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Als CSV speichern' }).click();
  expect((await download).suggestedFilename()).toMatch(/^auswertung-.+\.csv$/);
});

test('Aufgabe im Formular erstellen', async ({ page }) => {
  await page.getByRole('button', { name: 'Erstellen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await dialog.getByLabel('Titel').fill('Mein Netz');
  await dialog.getByRole('button', { name: '+ Lernziel' }).click();
  const goal = dialog.getByRole('group', { name: 'Ziel 4' });
  await goal.getByLabel('Prüfbaustein').selectOption('dhcpLease');
  await goal.getByLabel('Gerät', { exact: true }).fill('Notebook 1');
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.tasks')).toContainText('Mein Netz');
  await expect(page.locator('.tasks')).toContainText('Notebook 1 erhält eine Adresse per DHCP.');
});

test('Sprache wechseln und behalten', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Sprache' }).selectOption('fr');
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Simulateur de réseau' })).toBeVisible();
});
