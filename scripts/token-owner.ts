/**
 * Whose token? Shared by `token-create.ts` and `token-revoke.ts`.
 *
 * `--email`, else `OWNER_EMAIL`, else the only user in the table: the same
 * rule password login uses (`resolveOwnerUser`), so in dev, with one seeded
 * user, neither is needed.
 */
import { resolveOwnerUser } from '../lib/queries/users.ts';
import type { User } from '../lib/types.ts';

/** The owner, or null after saying on stderr why there isn't one. */
export async function resolveTokenOwner(
  script: string,
  email: string | undefined,
): Promise<User | null> {
  const owner = await resolveOwnerUser(email ?? process.env.OWNER_EMAIL);
  if ('user' in owner) return owner.user;

  switch (owner.reason) {
    case 'unknown-email':
      console.error(`${script}: no user has the email "${owner.email}".`);
      break;
    case 'no-users':
      console.error(`${script}: no users exist — run \`npm run db:seed\` first.`);
      break;
    case 'ambiguous':
      console.error(
        `${script}: ${owner.userCount} users exist, so the owner is ambiguous. ` +
          'Pass --email <address>.',
      );
      break;
  }
  return null;
}
