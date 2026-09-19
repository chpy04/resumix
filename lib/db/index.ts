/**
 * Connection singleton. `postgres.js` client + `drizzle-orm/postgres-js`.
 * Server-only — nothing under `components/**` may import this (see
 * docs/ARCHITECTURE.md). Cached on `globalThis` so Next.js dev HMR does not
 * open a fresh pool on every module reload.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema.ts';

declare global {
  // eslint-disable-next-line no-var
  var __resumixSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __resumixDb: PostgresJsDatabase<typeof schema> | undefined;
}

function createClient(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return postgres(url);
}

export const sql = globalThis.__resumixSql ?? createClient();
export const db: PostgresJsDatabase<typeof schema> =
  globalThis.__resumixDb ?? drizzle(sql, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__resumixSql = sql;
  globalThis.__resumixDb = db;
}
