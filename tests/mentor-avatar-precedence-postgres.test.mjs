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
