/**
 * Applies any `drizzle/*.sql` files not yet recorded in `_migrations`, in
 * filename order, each inside its own transaction. Safe to re-run — already
 * applied files are skipped.
 *
 * Usage: node --experimental-strip-types scripts/migrate.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'drizzle');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  // Silence routine NOTICEs (e.g. "table already exists, skipping" on the
  // idempotent `create table if not exists _migrations` below).
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`
      create table if not exists _migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const appliedRows = await sql<{ filename: string }[]>`select filename from _migrations`;
    const applied = new Set(appliedRows.map((r) => r.filename));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }

      const contents = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`apply ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into _migrations (filename) values (${file})`;
      });
      ranCount++;
    }

    console.log(
      ranCount === 0
        ? 'Nothing to do — database is up to date.'
        : `Applied ${ranCount} migration(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
