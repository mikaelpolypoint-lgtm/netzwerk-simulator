import { defineConfig } from '@playwright/test';

// Oberflächentests gegen den fertigen Build (dist/index.html, mit CSP).
// Sie nutzen den installierten Browser statt eigene Browser herunterzuladen:
// unter Windows Edge, sonst Chrome; mit PW_CHANNEL lässt sich das ändern.
// Alternativ mit PW_EXECUTABLE den Pfad zu einem Chromium angeben (z.B. auf Servern ohne Chrome).
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const executablePath = process.env.PW_EXECUTABLE;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    ...(executablePath ? { launchOptions: { executablePath, args: ['--no-sandbox'] } } : { channel }),
    locale: 'de-CH',
  },
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
  },
});
