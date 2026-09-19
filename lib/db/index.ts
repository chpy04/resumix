/**
 * Connection singleton. `postgres.js` client + `drizzle-orm/postgres-js`.
 * Server-only — nothing under `components/**` may import this (see
 * docs/ARCHITECTURE.md).
 *
 * The client is created **lazily, on first query**, not at import time.
 * `next build` evaluates every route module while collecting page data, so an
 * eager `postgres(process.env.DATABASE_URL!)` at module scope makes the build
 * fail on any machine without a database configured. Both exports are
 * therefore Proxies that construct the real client on first property access,
 * and cache it on `globalThis` so dev HMR does not open a fresh pool per
 * reload.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.ts';

declare global {
  var __resumixSql: Sql | undefined;

  var __resumixDb: PostgresJsDatabase<typeof schema> | undefined;
}

function getSql(): Sql {
  if (globalThis.__resumixSql) return globalThis.__resumixSql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, or start the database with `docker compose up -d db`.',
    );
  }

  // Supabase's Supavisor runs in transaction-pooling mode, which does not
  // support prepared statements; `prepare: false` keeps the same code working
  // against both a plain container and the pooler. `max: 1` suits serverless,
  // where each instance handles one request at a time anyway.
  const client = postgres(url, {
    max: process.env.VERCEL ? 1 : 10,
    prepare: false,
  });
  globalThis.__resumixSql = client;
  return client;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (globalThis.__resumixDb) return globalThis.__resumixDb;
  const instance = drizzle(getSql(), { schema });
  globalThis.__resumixDb = instance;
  return instance;
}

/** Lazy proxy — the pool is opened on first use, never at import. */
export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  get: (_t, prop, receiver) => Reflect.get(getSql(), prop, receiver),
  apply: (_t, _thisArg, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
});

/** Lazy proxy — see `sql`. */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  { get: (_t, prop, receiver) => Reflect.get(getDb(), prop, receiver) },
);
