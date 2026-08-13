import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/202607260006_uid_auth.sql",
  import.meta.url,
);

test("UID migration is authenticated, private, unique, and activation-gated", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();

  assert.match(sql, /add column[^;]+public_uid integer/);
  assert.match(sql, /public_uid between 10000 and 999999/);
  assert.match(sql, /unique[^;]+public_uid|create unique index[^;]+public_uid/);
  assert.match(sql, /create table public\.uid_selection_sessions/);
  assert.match(sql, /owner_id uuid[^;]+auth\.users/);
  assert.match(sql, /refreshes_used[^;]+between 0 and 3/);
  assert.match(sql, /create table public\.uid_selection_candidates/);
  assert.match(sql, /create or replace function public\.is_activated_user/);
  assert.match(sql, /create or replace function public\.start_uid_selection/);
  assert.match(sql, /create or replace function public\.get_uid_selection_state/);
  assert.match(sql, /create or replace function public\.refresh_uid_selection/);
  assert.match(sql, /create or replace function public\.complete_uid_selection/);
  assert.doesNotMatch(
    sql,
    /create policy[^;]+uid_selection_sessions[^;]+to anon/,
  );
});

test("UID migration protects write paths until activation", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();

  for (const table of [
    "posts",
    "comments",
    "private_entries",
    "workbench_analyses",
    "ai_jobs",
  ]) {
    assert.match(
      sql,
      new RegExp(`create policy[^;]+${table}[^;]+is_activated_user`, "s"),
    );
  }
});

test("UID refresh quota is account-persistent and cannot reset on page reload", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();

  assert.match(sql, /owner_id uuid not null unique references auth\.users/);
  assert.match(sql, /refreshes_used smallint not null default 0/);
  assert.match(sql, /max_refreshes smallint not null default 3/);
  assert.match(
    sql,
    /refreshes_remaining', greatest\(0, sessions\.max_refreshes - sessions\.refreshes_used\)/,
  );
  assert.match(
    sql,
    /create or replace function public\.get_uid_selection_state\(\)[\s\S]+return public\._uid_selection_state\(actor\)/,
  );
  const expiredRestart = sql.match(
    /if session_row\.status in \('expired', 'revoked'\)[\s\S]+?return public\._uid_selection_state\(actor\);/,
  )?.[0] ?? "";
  assert.doesNotMatch(expiredRestart, /refreshes_used\s*=\s*0/);
});
