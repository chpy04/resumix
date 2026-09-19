import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a real dev server, a real Postgres, and the real latex sidecar.
 * Assumes `docker compose up -d db latex` is already running; the webServer
 * block starts Next.js and seeds the database first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --experimental-strip-types scripts/seed.ts --force && npx next dev --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://resumix:resumix@localhost:5433/resumix',
      LATEX_SERVICE_URL: process.env.LATEX_SERVICE_URL ?? 'http://localhost:8080',
      APP_PASSWORD: 'e2e-password',
      AUTH_SECRET: 'e2e-secret',
    },
  },
});
