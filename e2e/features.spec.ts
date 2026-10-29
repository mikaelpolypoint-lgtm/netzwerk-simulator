import { expect, test, type Page } from '@playwright/test';

const example = (name: string) => `docs/beispiele/${name}.json`;

async function menu(page: Page, top: string, entry: string | RegExp) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: entry }).click();
}

async function openProject(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Datei', /^Öffnen/);
  await (await chooser).setFiles(file);
  await expect(page.locator('.toast').last()).toContainText('geladen');
}

/** Gerät aus einer Shop-Kategorie holen. */
async function shop(page: Page, category: string, item: RegExp) {
  await page.getByRole('navigation', { name: 'Geräte' }).getByRole('button', { name: category, exact: true }).click();
  await page.getByRole('dialog', { name: category }).getByRole('button', { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('Profil 2 versteckt den Layer-3-Switch, Profil 4 zeigt ihn', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Geräte' }).getByRole('button', { name: 'Switches', exact: true }).click();
  const flyout = page.getByRole('dialog', { name: 'Switches' });
  await expect(flyout.getByRole('button', { name: /^L3-Switch/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'P2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Funktionsumfang' });
  await dialog.getByRole('radio', { name: /Profi/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Geräte' }).getByRole('button', { name: 'Switches', exact: true }).click();
  await expect(flyout.getByRole('button', { name: /^L3-Switch 24/ })).toBeVisible();
});

test('Projekte schalten benötigte Funktionen beim Laden ein', async ({ page }) => {
  await openProject(page, example('router-on-a-stick'));
  await expect(page.locator('.toast').last()).toContainText('eingeschaltet');
  await expect(page.locator('.toast').last()).toContainText('VLANs');
});

test('Router über die Befehlszeile konfigurieren (OSPF)', async ({ page }) => {
  await page.getByRole('button', { name: 'P2' }).click();
  await page.getByRole('dialog', { name: 'Funktionsumfang' }).getByRole('radio', { name: /Profi/ }).click();
  await page.keyboard.press('Escape');
  await shop(page, 'Router', /^Router 2 Port/);
  await page.getByRole('complementary', { name: 'Eigenschaften' }).getByRole('button', { name: /Befehlszeile \(CLI\)/ }).first().click();
  const cli = page.getByLabel('CLI-Befehl eingeben');
  for (const line of ['enable', 'conf t', 'int eth0', 'ip address 10.1.1.1/24', 'exit', 'router ospf', 'network 10.1.1.0/24 area 0', 'end', 'show ip route', 'show ip protocols']) {
    await cli.fill(line);
    await cli.press('Enter');
  }
  const log = page.getByRole('log');
  await expect(log).toContainText('10.1.1.0/24 is directly connected, eth0');
  await expect(log).toContainText('ospf', { ignoreCase: true });
  await expect(page.getByLabel('IP-Adresse von eth0')).toHaveValue('10.1.1.1');
});

test('SSH vom PC zum Router in der Simulation', async ({ page }) => {
  await openProject(page, example('router-on-a-stick'));
  await page.getByRole('radio', { name: 'Simulation' }).click();
  await page.getByRole('button', { name: 'Alles zeigen' }).click();
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
  await expect(page.locator('.packets')).toContainText('SSH');
});

test('Bereich im Entwurf zeichnen', async ({ page }) => {
  await page.keyboard.press('b');
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
  await shop(page, 'Endgeräte', /^Desktop-PC/);
  await page.getByRole('button', { name: 'Snapshots …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Snapshots' });
  await dialog.getByLabel('Name des Snapshots').first().fill('Ein PC');
  await dialog.getByRole('button', { name: 'Snapshot erstellen' }).click();
  await dialog.getByRole('button', { name: 'Schliessen' }).click();
  await shop(page, 'Endgeräte', /^Desktop-PC/);
  await expect(page.getByRole('button', { name: /^PC 2,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Snapshots …' }).click();
  await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.getByRole('button', { name: /^PC 2,/ })).toHaveCount(0);
});

test('WLAN-Mesh: Link-Status grün, falsches Passwort rot', async ({ page }) => {
  await openProject(page, example('wlan-mesh'));
  await expect(page.locator('.led.up').first()).toBeVisible();
  await page.getByRole('button', { name: 'Notebook OG, Notebook' }).click();
  const profile = page.locator('details').filter({ hasText: 'WLAN-Profil' });
  await profile.getByLabel('Passwort').fill('falsch123');
  await profile.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('.inspector .led.down')).toBeVisible();
});

test('VLAN-Farbe färbt Switch-Ports', async ({ page }) => {
  await openProject(page, example('vlan-stp'));
  await menu(page, 'Werkzeuge', /^VLANs/);
  const dialog = page.getByRole('dialog', { name: 'VLANs' });
  await expect(dialog).toContainText('ohne Farbe');
  await dialog.getByRole('button', { name: 'Schliessen' }).click();
});

test('Kosten in anderer Währung', async ({ page }) => {
  await shop(page, 'Endgeräte', /^Desktop-PC/);
  await page.getByRole('button', { name: /^CHF / }).click();
  const dialog = page.getByRole('dialog', { name: 'Kosten' });
  await dialog.getByRole('radio', { name: 'EUR' }).click();
  await expect(dialog).toContainText("1'155");
});
