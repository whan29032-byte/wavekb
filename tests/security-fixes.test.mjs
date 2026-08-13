import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createCommunityRepository } = require("../community/community-repository.js");

test("public posts hydrate authors through the allowlisted profile RPC", async () => {
  let selectedColumns = "";
  let rpcInput = null;
  const client = {
    from(table) {
      assert.equal(table, "posts");
      return {
        select(columns) {
          selectedColumns = columns;
          return this;
        },
        eq() { return this; },
        order() { return this; },
        async range() {
          return {
            data: [{ id: "post-1", author_id: "user-1", post_images: [] }],
            error: null,
          };
        },
      };
    },
    async rpc(name, input) {
      assert.equal(name, "get_public_post_profiles");
      rpcInput = input;
      return {
        data: [{
          id: "user-1",
          public_uid: 583104,
          display_name: "Wave",
        }],
        error: null,
      };
    },
  };
  const repository = createCommunityRepository(client);

  const posts = await repository.listPosts("idea_sharing");

  assert.equal(selectedColumns.includes("profiles!"), false);
  assert.equal(selectedColumns.includes("chart_package"), true);
  assert.deepEqual(rpcInput, { p_ids: ["user-1"] });
  assert.equal(posts[0].profiles.public_uid, 583104);
});

test("security migration validates external reference domains on the server", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/202608130001_public_content_security.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /posts_external_reference_matches_kind/);
  assert.match(sql, /public\.external_reference_kind/);
  assert.match(sql, /youtube\\\.com/);
  assert.match(sql, /youtu\\\.be/);
  assert.match(sql, /x\\\.com\|twitter\\\.com/);
  assert.match(sql, /is distinct from p_external_kind/);
  assert.match(sql, /public\.get_public_post_profiles/);
  assert.match(sql, /to anon, authenticated/);
});

test("Supabase migration versions are unique", async () => {
  const names = (await readdir(
    new URL("../supabase/migrations/", import.meta.url),
  )).filter((name) => name.endsWith(".sql"));
  const versions = names.map((name) => name.split("_", 1)[0]);

  assert.equal(versions.length, new Set(versions).size);
});

test("user AI connection migration is safe to reapply", async () => {
  const sql = (await readFile(
    new URL("../supabase/migrations/202607260010_user_ai_connections.sql", import.meta.url),
    "utf8",
  )).toLowerCase();

  assert.match(sql, /create table if not exists public\.user_ai_connections/);
  assert.match(sql, /create table if not exists public\.user_ai_connection_secrets/);
  assert.match(sql, /add column if not exists user_connection_id/);
  assert.match(sql, /drop policy if exists/);
  assert.doesNotMatch(sql, /user_ai_connection_secrets for select/);
  assert.doesNotMatch(sql, /user_ai_connection_secrets for insert/);
});
