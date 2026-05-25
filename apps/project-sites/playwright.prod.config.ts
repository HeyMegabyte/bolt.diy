import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'voice.spec.ts',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: process.env.PROD_URL ?? 'https://projectsites.dev',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
