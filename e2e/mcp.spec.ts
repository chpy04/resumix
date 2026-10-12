import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';

/**
 * Runs `scripts/mcp-smoke.ts` against Playwright's own server, which is how
 * `npm run verify` runs it (D-040). The gate starts no other server, and a
 * second `next` process in this checkout would corrupt `.next`.
 *
 * Running here also means after global-setup's reseed, so the token the
 * script mints survives, and in password mode, so it shows `/api/mcp` takes
 * only its own token outside dev mode too (D-039). The script makes every
 * assertion; a non-zero exit fails this test.
 */
test('the MCP endpoint answers a real client over HTTP', ({ baseURL }) => {
  execFileSync('node', ['--experimental-strip-types', 'scripts/mcp-smoke.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://resumix:resumix@localhost:5433/resumix',
      MCP_SMOKE_URL: `${baseURL}/api/mcp`,
    },
  });
});
