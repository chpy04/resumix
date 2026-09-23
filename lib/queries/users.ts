/**
 * The `users` table: lookups, creation, and first-login provisioning.
 *
 * Every other query module takes a `userId` and filters by it. This one
 * produces those ids, so it is the only module here that is not itself
 * user-scoped.
 */
import { asc, eq, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { coverLetter, resume, template, users } from '../db/schema.ts';
import { DEFAULT_COVER_LETTER } from '../render/default-cover-letter.ts';
import { DEFAULT_TEMPLATE } from '../render/default-template.ts';
import type { User } from '../types.ts';

type UserRow = typeof users.$inferSelect;

function toWire(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * The session in `dev` auth mode: whoever was created first. With the
 * seed's single user that is unambiguous; if a dev database somehow has
 * several, `created_at` then `id` keeps the choice stable across restarts
 * rather than depending on Postgres's physical row order.
 */
export async function getFirstUser(): Promise<User | null> {
  const [row] = await db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
  return row ? toWire(row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toWire(row) : null;
}

/** Case-insensitive, matching the `ux_users_email_lower` unique index. */
export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(raw`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row ? toWire(row) : null;
}

export async function getUserBySupabaseUserId(supabaseUserId: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1);
  return row ? toWire(row) : null;
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: raw<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

/** Links an existing local user to a Supabase identity on first OAuth sign-in. */
export async function linkSupabaseUserId(id: string, supabaseUserId: string): Promise<User> {
  const [row] = await db.update(users).set({ supabaseUserId }).where(eq(users.id, id)).returning();
  if (!row) throw new Error(`user ${id} not found`);
  return toWire(row);
}

export interface NewUser {
  email: string;
  name?: string | null;
  supabaseUserId?: string | null;
}

/**
 * Creates a user and the minimum they need to be useful: their own copy of
 * the default template, a "Default" resume bound to it with nothing
 * selected yet, and a "Default" cover letter.
 *
 * All three are per-user, not shared. A template is editable content like
 * any other, so two users sharing one row would mean either of them
 * silently rewriting the other's resumes. The empty Default resume matters
 * because `POST /api/resumes` clones it — without one, a new user could not
 * create their first resume at all — and the Default cover letter is what
 * `POST /api/applications/:id/cover-letter` copies, for the same reason.
 *
 * One transaction: a user with no default template is a broken account, not
 * a partially-set-up one.
 */
export async function provisionUser(newUser: NewUser): Promise<User> {
  return db.transaction(async (tx) => {
    const [userRow] = await tx
      .insert(users)
      .values({
        email: newUser.email,
        name: newUser.name ?? null,
        supabaseUserId: newUser.supabaseUserId ?? null,
      })
      .returning();
    if (!userRow) throw new Error('failed to create user');

    const [templateRow] = await tx
      .insert(template)
      .values({
        name: 'Default',
        content: DEFAULT_TEMPLATE,
        isDefault: true,
        userId: userRow.id,
      })
      .returning({ id: template.id });
    if (!templateRow) throw new Error('failed to create default template');

    const [coverLetterRow] = await tx
      .insert(coverLetter)
      .values({
        name: 'Default',
        content: DEFAULT_COVER_LETTER,
        isDefault: true,
        userId: userRow.id,
      })
      .returning({ id: coverLetter.id });
    if (!coverLetterRow) throw new Error('failed to create default cover letter');

    const [resumeRow] = await tx
      .insert(resume)
      .values({
        name: 'Default',
        isDefault: true,
        templateId: templateRow.id,
        userId: userRow.id,
      })
      .returning({ id: resume.id });
    if (!resumeRow) throw new Error('failed to create default resume');

    return toWire(userRow);
  });
}
