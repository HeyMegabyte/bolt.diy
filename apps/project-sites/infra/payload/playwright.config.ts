import { defineConfig, devices } from '@playwright/test'

/**
 * E2E against the LIVE CMS (cms.projectsites.dev) — homepage-first, real navigation.
 * No webServer: the container is already deployed. Override target with PROD_URL.
 */
const baseURL = process.env.PROD_URL || 'https://cms.projectsites.dev'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Container can cold-boot ~tens of seconds on first hit.
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
