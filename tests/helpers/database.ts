import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Minimal stand-in for the parts of Supabase our migrations depend on.
 *
 * Supabase provides the `auth` schema, the `auth.users` table and the three
 * API roles. PGlite is plain Postgres, so we recreate just enough of that
 * surface for the migrations to apply unchanged — which is the point: the SQL
 * under test is byte-for-byte the SQL that ships.
 */
const SUPABASE_HARNESS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public to anon, authenticated, service_role;

  create schema if not exists auth;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- Mirrors Supabase's auth.uid(), reading the caller identity from a GUC.
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $harness$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $harness$;

  grant usage on schema auth to anon, authenticated, service_role;
`;

export type TestDb = {
  db: PGlite;
  /** Run subsequent statements as this authenticated user. */
  asUser: (userId: string) => Promise<void>;
  /** Run subsequent statements as an unauthenticated visitor. */
  asAnon: () => Promise<void>;
  /** Drop back to the superuser session, bypassing RLS, for seeding. */
  asAdmin: () => Promise<void>;
  /**
   * Act as `service_role` — the identity the admin client uses.
   *
   * Distinct from `asAdmin`, which is the superuser and therefore sees no
   * grant errors at all. Seeding as the superuser is exactly why missing
   * service_role grants went unnoticed until the suite ran against real
   * Supabase.
   */
  asServiceRole: () => Promise<void>;
  /** Create an auth user (the profile row follows from the trigger). */
  createUser: (email: string, displayName?: string) => Promise<string>;
  close: () => Promise<void>;
};

/** Boots a fresh Postgres and applies every migration in filename order. */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_HARNESS);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  const asAdmin = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  };

  const asUser = async (userId: string) => {
    await db.exec(`reset role;`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await db.exec(`set role authenticated;`);
  };

  const asServiceRole = async () => {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
    await db.exec(`set role service_role;`);
  };

  const asAnon = async () => {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
    await db.exec(`set role anon;`);
  };

  const createUser = async (email: string, displayName?: string) => {
    await asAdmin();
    const meta = displayName ? JSON.stringify({ full_name: displayName }) : "{}";
    const result = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email, meta],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to create user ${email}`);
    return row.id;
  };

  return {
    db,
    asUser,
    asAnon,
    asAdmin,
    asServiceRole,
    createUser,
    close: () => db.close(),
  };
}

/** Asserts that a statement is rejected, returning the error message. */
export async function expectDenied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the statement to be denied, but it succeeded");
}
