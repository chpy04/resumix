/**
 * Mints an API token for `/api/mcp/**` and prints its secret, once (D-039).
 *
 * Only the secret goes to stdout, so
 *
 *   TOKEN=$(npm run -s token:create -- --label laptop-agent)
 *
 * captures exactly it. The token's id (what `token:revoke` takes), its label,
 * its owner and the warning that it will not be shown again all go to
 * stderr. Only the hash is stored; lose the secret and you mint another.
 *
 * Acts on whatever database `DATABASE_URL` names — the dev one, through
 * `.env`, unless you point it elsewhere.
 *
 * Usage:
 *   npm run token:create -- --label <label> [--email <owner>]
 */
import { parseArgs } from 'node:util';

import { sql } from '../lib/db/index.ts';
import { createApiToken } from '../lib/queries/api-tokens.ts';
import { resolveTokenOwner } from './token-owner.ts';

const USAGE = 'usage: npm run token:create -- --label <label> [--email <owner>]';

async function main() {
  let label: string | undefined;
  let email: string | undefined;
  try {
    const { values } = parseArgs({
      options: { label: { type: 'string' }, email: { type: 'string' } },
    });
    label = values.label?.trim();
    email = values.email;
  } catch (err) {
    console.error(`token:create: ${(err as Error).message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (!label) {
    console.error(`token:create: --label is required.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  try {
    const owner = await resolveTokenOwner('token:create', email);
    if (!owner) {
      process.exitCode = 1;
      return;
    }

    const { token, secret } = await createApiToken(owner.id, label);
    console.error(`Created API token ${token.id} ("${token.label}") for ${owner.email}.`);
    console.error('This is the only time the secret is shown. Store it now:');
    console.log(secret);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
