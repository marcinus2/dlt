import { defineConfig, devices } from '@playwright/test';
import { Y4M_PATH } from './e2e/tools/make-y4m.ts';

const PORT = 4173;

// Chromium's fake camera plays the synthetic clip (plan 5.4), generated in global setup.
const FAKE_CAMERA = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-video-capture=${Y4M_PATH}`,
];

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'], launchOptions: { args: FAKE_CAMERA }, permissions: ['camera'] },
    },
    // WebKit: layout smoke + axe only.
    { name: 'webkit', use: { ...devices['iPhone 15'] }, testMatch: ['smoke.spec.ts', 'gallery.spec.ts'] },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
