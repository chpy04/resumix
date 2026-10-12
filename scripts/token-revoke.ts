/**
 * Revokes one API token by id (D-039). The row stays, with `revoked_at` set,
 * and the secret stops working on the next request. Revoking it again is
 * harmless and keeps the original date.
 *
 * The id is the one `token:create` printed. A token belonging to someone
 * other than the owner (`--email`, else `OWNER_EMAIL`, else the only user)
 * is reported as not found, the same as one that does not exist.
 *
 * Acts on whatever database `DATABASE_URL` names.
 *
 * Usage:
 *   npm run token:revoke -- <id> [--email <owner>]
 */
import { parseArgs } from 'node:util';

import { sql } from '../lib/db/index.ts';
import { revokeApiToken } from '../lib/queries/api-tokens.ts';
import { NotFoundError } from '../lib/queries/errors.ts';
import { resolveTokenOwner } from './token-owner.ts';

const USAGE = 'usage: npm run token:revoke -- <id> [--email <owner>]';

/** Checked here so a typo is a usage error rather than a Postgres cast error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  let id: string | undefined;
  let email: string | undefined;
  try {
    const { values, positionals } = parseArgs({
      options: { email: { type: 'string' } },
      allowPositionals: true,
    });
    if (positionals.length !== 1) throw new Error('expected exactly one token id');
    id = positionals[0];
    email = values.email;
  } catch (err) {
    console.error(`token:revoke: ${(err as Error).message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (!id || !UUID.test(id)) {
    console.error(`token:revoke: "${id}" is not a token id.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  try {
    const owner = await resolveTokenOwner('token:revoke', email);
    if (!owner) {
      process.exitCode = 1;
      return;
    }

    const token = await revokeApiToken(owner.id, id);
    console.log(
      `Revoked API token ${token.id} ("${token.label}") for ${owner.email} at ${token.revokedAt}.`,
    );
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    console.error(`token:revoke: no API token ${id} belongs to this owner.`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
