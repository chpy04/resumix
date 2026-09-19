import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a real dev server, a real Postgres, and the real latex sidecar.
 * Assumes `docker compose up -d db latex` is already running; the webServer
 * block starts Next.js and seeds the database first.
 *
 * `RESUMIX_AUTH_MODE=password` is set explicitly (T14): the browser suite
 * drives the real login screen, so it must not pick up the `dev` default
 * that local development uses. Dev mode — where there is no login screen and
 * the session is the seeded user — is covered in-process by
 * `lib/session.test.ts` instead of a second server here, because two
 * concurrent `next dev` processes cannot share a build directory and
 * splitting them makes Next rewrite `tsconfig.json`/`next-env.d.ts` on every
 * run.
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
    command:
      'node --experimental-strip-types scripts/seed.ts --force && npx next dev --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://resumix:resumix@localhost:5433/resumix',
      LATEX_SERVICE_URL: process.env.LATEX_SERVICE_URL ?? 'http://localhost:8080',
      APP_PASSWORD: 'e2e-password',
      AUTH_SECRET: 'e2e-secret',
      RESUMIX_AUTH_MODE: 'password',
    },
  },
});
