import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/202609090001_mentor_avatar_precedence.sql", import.meta.url);

async function avatarResolverSql() {
  const sql = await readFile(migration, "utf8");
  const match = sql.match(/create or replace function public\.mentor_display_avatar[\s\S]+?\$\$;/);
  assert.ok(match, "migration must define mentor_display_avatar");
  return match[0];
}

async function schemaVersionSql() {
  const sql = await readFile(migration, "utf8");
  const match = sql.match(/create or replace function public\.wavekb_schema_version\(\)[\s\S]+?\$\$;/);
  assert.ok(match, "migration must advance the public schema marker");
  return match[0];
}

test("bound platform avatars take precedence while empty and unbound owners retain the mentor fallback", async () => {
  const database = new PGlite();
  try {
    await database.exec("create table public.profiles (id uuid primary key, avatar_url text);");
    await database.exec(await avatarResolverSql());
    await database.exec("insert into public.profiles (id, avatar_url) values ('11111111-1111-4111-8111-111111111111', 'https://cdn.example/platform.png'), ('22222222-2222-4222-8222-222222222222', '   ');");

    const result = await database.query("select public.mentor_display_avatar('11111111-1111-4111-8111-111111111111', 'https://cdn.example/legacy.png') as platform_avatar, public.mentor_display_avatar('22222222-2222-4222-8222-222222222222', 'https://cdn.example/legacy.png') as empty_owner_avatar, public.mentor_display_avatar(null, 'https://cdn.example/legacy.png') as unbound_avatar;");

    assert.deepEqual(result.rows[0], {
      platform_avatar: "https://cdn.example/platform.png",
      empty_owner_avatar: "https://cdn.example/legacy.png",
      unbound_avatar: "https://cdn.example/legacy.png",
    });
  } finally {
    await database.close();
  }
});

test("mentor avatar migration publishes the exact schema marker last without exposing its internal helper", async () => {
  const sql = await readFile(migration, "utf8");
  const marker = await schemaVersionSql();
  const revoke = sql.match(/revoke all on function public\.mentor_display_avatar\(uuid, text\) from [^;]+;/)?.[0];
  assert.ok(revoke, "migration must revoke direct access to its internal helper");
  const database = new PGlite();
  try {
    await database.exec("create role anon; create role authenticated; create table public.profiles (id uuid primary key, avatar_url text);");
    await database.exec(await avatarResolverSql());
    await database.exec("grant execute on function public.mentor_display_avatar(uuid, text) to anon, authenticated;");
    await database.exec(revoke);
    const privileges = await database.query("select has_function_privilege('anon', 'public.mentor_display_avatar(uuid, text)', 'execute') as anonymous, has_function_privilege('authenticated', 'public.mentor_display_avatar(uuid, text)', 'execute') as member;");
    assert.deepEqual(privileges.rows[0], { anonymous: false, member: false });

    await database.exec(marker);
    const result = await database.query("select public.wavekb_schema_version() as version;");
    assert.equal(result.rows[0].version, "202609090001");
  } finally {
    await database.close();
  }

  assert.ok(sql.indexOf("create or replace function public.wavekb_schema_version()") > sql.indexOf("create or replace function public.get_mentor_thread"));
  assert.match(sql, /revoke all on function public\.mentor_display_avatar\(uuid, text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.mentor_display_avatar/);
  assert.match(sql, /notify pgrst, 'reload schema';/);
});
