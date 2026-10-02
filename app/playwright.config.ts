import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Fake-camera flags are added in M5.
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    // WebKit: layout smoke + axe only.
    { name: 'webkit', use: { ...devices['iPhone 15'] }, testMatch: ['smoke.spec.ts', 'gallery.spec.ts'] },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
