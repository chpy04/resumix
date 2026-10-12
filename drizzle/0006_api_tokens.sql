-- API tokens: the credential an agent uses to call `/api/mcp/**` (D-039).
--
-- A second way into one account, separate from the shared `APP_PASSWORD`.
-- That password is too broad to hand to an agent: it unlocks the whole UI,
-- cannot be withdrawn from one caller without logging everyone out, and is
-- the same string for every machine that holds it. A token is one random
-- secret per agent, revocable on its own.
--
-- Only `token_hash`, the hex sha-256 of the secret, is stored. The secret is
-- printed once by `npm run token:create` and is unrecoverable afterwards. An
-- unsalted fast hash is enough because the secret is 32 random bytes, not
-- something a person chose: there is no dictionary to precompute, and an
-- equality lookup on the hash is what makes the unique index the lookup path.
--
-- No begin/commit here: scripts/migrate.ts wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- api_token
--
-- An eighth root table: it carries `user_id` like every other root (D-018),
-- with `on delete restrict` for the same reason the others have it (D-011).
--
-- Tokens are revoked, never deleted. `revoked_at` is set once and never
-- cleared, and together with `last_used_at` the row stays a record of what
-- had access to the account and when it last used it.
-- ---------------------------------------------------------------------------

create table api_token (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete restrict,
  -- Which agent or machine holds it, so you know which one to revoke.
  label        text not null,
  token_hash   text not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index ux_api_token_token_hash on api_token (token_hash);

create index ix_api_token_user_id on api_token (user_id);

create trigger set_updated_at before update on api_token
for each row execute function set_updated_at();
