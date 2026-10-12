/**
 * `ping`: proves the whole path, token to database, and nothing else. Not
 * the JSON-RPC `ping` method, which only proves the server is up.
 */
import { z } from 'zod';
import { getUserById } from '../../queries/users.ts';
import { defineTool, toolError, toolText } from '../tool.ts';

export const ping = defineTool({
  name: 'ping',
  description:
    'Checks that the Resumix connection and token work. Call it first, or when another tool ' +
    'fails with a connection or auth error. Returns the email of the account this token ' +
    'belongs to, as plain text.',
  input: z.strictObject({}),
  async run(ctx) {
    const user = await getUserById(ctx.userId);
    // The token resolved a moment ago, so this means the account was removed
    // in between: a race, but one with a clear fix.
    if (!user) {
      return toolError(
        "This token's Resumix account no longer exists. Mint a new token with " +
          '`npm run token:create` and reconnect.',
      );
    }
    return toolText(user.email);
  },
});
