import { expect, test, type Page } from '@playwright/test';

const example = (name: string) => `docs/beispiele/${name}.json`;
const task = (name: string) => `docs/aufgaben/${name}.json`;

/** Menü der Menüleiste öffnen und einen Eintrag wählen. */
async function menu(page: Page, top: string, entry: string | RegExp) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: entry }).click();
}

/** Öffnet ein Projekt über «Datei → Öffnen …». */
async function openProject(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Datei', /^Öffnen/);
  await (await chooser).setFiles(file);
  await expect(page.locator('.toast').last()).toContainText('geladen');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('lädt ohne eine einzige Netzwerkanfrage ausser der Seite selbst', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.reload();
  await expect(page.getByRole('menubar')).toBeVisible();
  expect(requests).toEqual(['http://localhost:4174/']);
});

test('Startmeldung verschwindet, sobald das Programm läuft', async ({ page }) => {
  await expect(page.getByRole('menubar')).toBeVisible();
  await expect(page.locator('#boot')).toHaveCount(0);
});

test('zeigt statt einer weissen Seite einen Hinweis, wenn Skripte blockiert sind', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#boot')).toContainText('startet das Programm nicht');
  await context.close();
});

test('startet leer im Entwurf', async ({ page }) => {
  await expect(page.getByRole('radio', { name: 'Entwurf' })).toBeChecked();
  await expect(page.getByRole('application').getByRole('button')).toHaveCount(0);
});

test('Gerät aus dem Shop holen und rückgängig machen', async ({ page }) => {
  await page.getByRole('button', { name: 'Endgeräte' }).click();
  await page.getByRole('dialog', { name: 'Endgeräte' }).getByRole('button', { name: /^Desktop-PC/ }).click();
  const pc = page.getByRole('application').getByRole('button', { name: /^PC 1,/ });
  await expect(pc).toBeVisible();
  await expect(page.getByRole('button', { name: /^CHF / })).toHaveText(/1.100/);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(pc).toHaveCount(0);
});

test('Ping über einen Router in der Simulation, mit Filter und OSI-Ansicht', async ({ page }) => {
  await openProject(page, example('zwei-subnetze'));
  await page.keyboard.press('m');
  await expect(page.getByRole('radio', { name: 'Simulation' })).toBeChecked();
  await page.getByRole('button', { name: 'PC 1, Rechner' }).click();
  await page.getByRole('button', { name: 'Desktop öffnen' }).click();
  const input = page.getByLabel('Befehl eingeben');
  await input.fill('ping 192.168.2.10');
  await input.press('Enter');
  await expect(page.getByRole('log')).toContainText('Antwort von 192.168.2.10', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Desktop schliessen' }).click();

  const packets = page.locator('.packets');
  await packets.getByRole('searchbox').fill('icmp and ip.dst == 192.168.2.10');
  await expect(packets.locator('tbody tr').first()).toContainText('ICMP');
  await expect(packets.locator('tbody')).not.toContainText('ARP');
  await packets.locator('tbody tr').first().click();
  const details = page.locator('.details');
  await expect(details).toContainText('Vermittlung');
  await expect(details).toContainText('IPv4');
  // Fehlerhafter Filter wird gemeldet.
  await packets.getByRole('searchbox').fill('icmp and (');
  await expect(packets.getByRole('status')).toContainText('Filter');
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

test('Aufgabe im Formular erstellen, auch mit neuen Prüfbausteinen', async ({ page }) => {
  await menu(page, 'Werkzeuge', /^Aufgabe erstellen/);
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await dialog.getByLabel('Titel').fill('Mein Netz');
  await dialog.getByRole('button', { name: '+ Lernziel' }).click();
  const goal = dialog.getByRole('group', { name: 'Ziel 4' });
  await goal.getByLabel('Prüfbaustein').selectOption('budget');
  await goal.getByLabel('Höchstens (CHF)').fill('5000');
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.tasks')).toContainText('Mein Netz');
  await expect(page.locator('.tasks')).toContainText('Das Netz kostet höchstens 5000 CHF.');
});

test('Sprache und Darstellung wechseln und behalten', async ({ page }) => {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Ansicht', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sprache' }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'English' }).click();
  await expect(page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Admin-Konsole gibt es in der lokalen Datei nicht', async ({ page }) => {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Werkzeuge', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Admin-Konsole/ })).toHaveCount(0);
});

test('Aufgabe aus dem Katalog laden', async ({ page }) => {
  await page.getByRole('button', { name: /Aufgaben-Katalog/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Starten|Laden|Übernehmen/ }).first().click();
  await expect(page.locator('.tasks')).not.toBeEmpty();
});

test('Befehlssuche und Hilfe', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: /Befehl suchen/ });
  await palette.getByLabel(/Befehl oder Gerät suchen/).fill('IP-Rechner');
  await page.keyboard.press('Enter');
  const calc = page.getByRole('dialog', { name: 'IP-Rechner' });
  await calc.getByLabel(/Adresse/).first().fill('192.168.10.77/26');
  await expect(calc).toContainText('192.168.10.64');
  await expect(calc).toContainText('192.168.10.127');
  await page.keyboard.press('Escape');
  await page.keyboard.press('F1');
  await expect(page.getByRole('complementary', { name: 'Hilfe' })).toBeVisible();
});
