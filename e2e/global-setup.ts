import { execFileSync } from 'node:child_process';

/**
 * Force-reseeds the database once, before the suite starts.
 *
 * This used to be the first half of `webServer.command` ("seed && next dev").
 * That made the command a compound shell invocation, so Playwright's teardown
 * killed the shell while `next dev`'s own `next-server` child survived — every
 * interrupted run left a server squatting on :3100 and the next run failed
 * with "port is already used". Keeping `webServer.command` a single process
 * lets Playwright manage its lifetime properly.
 */
export default function globalSetup(): void {
  execFileSync('node', ['--experimental-strip-types', 'scripts/seed.ts', '--force'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://resumix:resumix@localhost:5433/resumix',
    },
  });
}
