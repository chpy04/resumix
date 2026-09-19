import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a real dev server, a real Postgres, and the real latex sidecar.
 * Assumes `docker compose up -d db latex` is already running. `globalSetup`
 * force-reseeds the database; `webServer` starts Next.
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
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    // A single process, deliberately. This used to be
    // `seed.ts --force && npx next dev`, and the compound shell command meant
    // Playwright's teardown killed the shell while next-server survived,
    // leaving :3100 occupied and failing the next run. Seeding moved to
    // e2e/global-setup.ts.
    command: 'next dev --port 3100',
    // `/`, not `/login`: this probe is also what warms the dev server's
    // per-route compilation, and every spec starts with `goto('/')`. Probing
    // a route the tests don't use left the first test paying a cold compile
    // inside its own timeout, which it intermittently lost.
    url: 'http://localhost:3100/',
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
