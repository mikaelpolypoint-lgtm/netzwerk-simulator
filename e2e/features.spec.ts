import { expect, test, type Page } from '@playwright/test';

const example = (name: string) => `docs/beispiele/${name}.json`;

async function openProject(page: Page, file: string) {
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.locator('.toast').last()).toContainText('geladen');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('Basis-Modus versteckt den Layer-3-Switch, Pro zeigt ihn', async ({ page }) => {
  const palette = page.locator('.palette');
  await expect(palette.getByRole('button', { name: /^Layer-3-Switch/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Pro' }).click();
  await expect(palette.getByRole('button', { name: /^Layer-3-Switch/ })).toBeVisible();
});

test('Pro-Projekte schalten beim Laden in den Pro-Modus', async ({ page }) => {
  await openProject(page, example('router-on-a-stick'));
  await expect(page.getByRole('radio', { name: 'Pro' })).toHaveAttribute('aria-checked', 'true');
});

test('Router über die Befehlszeile konfigurieren', async ({ page }) => {
  await page.locator('.palette').getByRole('button', { name: /^Vermittlungs/ }).click();
  await page.getByRole('button', { name: /Befehlszeile \(CLI\)/ }).click();
  const cli = page.getByLabel('CLI-Befehl eingeben');
  for (const line of ['enable', 'conf t', 'int eth0', 'ip address 10.1.1.1/24', 'end', 'show ip route']) {
    await cli.fill(line);
    await cli.press('Enter');
  }
  const log = page.getByRole('log');
  await expect(log).toContainText('C>* 10.1.1.0/24 is directly connected, eth0');
  // Die Konfiguration landet im Gerät: Das Formular zeigt die Adresse.
  await expect(page.getByLabel('IP-Adresse von eth0')).toHaveValue('10.1.1.1');
});

test('SSH vom PC zum Router im Aktionsmodus', async ({ page }) => {
  await openProject(page, example('router-on-a-stick'));
  await page.getByRole('radio', { name: 'Aktionsmodus' }).click();
  await page.getByRole('button', { name: 'Alles anzeigen' }).click();
  await page.getByRole('button', { name: 'PC Verwaltung, Rechner' }).click();
  await page.getByRole('button', { name: 'Desktop öffnen' }).click();
  const input = page.getByLabel('Befehl eingeben');
  await input.fill('ssh admin@192.168.10.1');
  await input.press('Enter');
  await input.fill('Netz2026');
  await input.press('Enter');
  const cli = page.getByLabel('CLI-Befehl eingeben');
  await expect(cli).toBeVisible({ timeout: 10_000 });
  await cli.fill('show ip route');
  await cli.press('Enter');
  await expect(page.getByRole('log').first()).toContainText('eth0.20');
  // Verschlüsselt in der Paketliste.
  await expect(page.locator('.packet-panel')).toContainText('SSH');
});

test('Bereich im Dokumentationsmodus zeichnen', async ({ page }) => {
  await page.getByRole('radio', { name: 'Dokumentation' }).click();
  await page.getByRole('button', { name: 'Bereich', exact: true }).click();
  const canvas = page.getByRole('application');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel('Netz (CIDR)').fill('192.168.5.0/26');
  await page.getByLabel('Netz (CIDR)').press('Tab');
  await expect(page.locator('.inspector')).toContainText('192.168.5.1 – 192.168.5.62');
  await expect(canvas).toContainText('Bereich 1');
});

test('Snapshot erstellen und wiederherstellen', async ({ page }) => {
  await page.locator('.palette').getByRole('button', { name: /^Rechner/ }).click();
  await page.getByRole('button', { name: /^Snapshots/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Snapshots' });
  await dialog.getByLabel('Name des Snapshots').first().fill('Ein PC');
  await dialog.getByRole('button', { name: 'Snapshot erstellen' }).click();
  await dialog.getByRole('button', { name: 'Schliessen' }).click();
  await page.locator('.palette').getByRole('button', { name: /^Rechner/ }).click();
  await expect(page.getByRole('button', { name: 'PC 2, Rechner' })).toBeVisible();
  await page.getByRole('button', { name: /^Snapshots/ }).click();
  await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.getByRole('button', { name: 'PC 2, Rechner' })).toHaveCount(0);
});

test('WLAN-Mesh: Link-Status grün, falsches Passwort rot', async ({ page }) => {
  await openProject(page, example('wlan-mesh'));
  await expect(page.locator('.led.up').first()).toBeVisible();
  await page.getByRole('button', { name: 'Notebook OG, Notebook' }).click();
  // Das Profil ist offen, weil das Notebook schon ein WLAN hat.
  const profile = page.locator('details').filter({ hasText: 'WLAN-Profil' });
  await profile.getByLabel('Passwort').fill('falsch123');
  await profile.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('.inspector .led.down')).toBeVisible();
});
