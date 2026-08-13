import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("personal mentor inbox never expands to every mentor for an admin", async () => {
  const sql = await read("supabase/migrations/202608040003_scope_personal_mentor_inbox.sql");
  const students = sql.slice(
    sql.indexOf("create or replace function public.list_my_mentor_students"),
    sql.indexOf("create or replace function public.list_my_mentor_payment_claims")
  );
  const claims = sql.slice(
    sql.indexOf("create or replace function public.list_my_mentor_payment_claims"),
    sql.indexOf("create or replace function public.review_mentor_payment_claim")
  );
  const review = sql.slice(
    sql.indexOf("create or replace function public.review_mentor_payment_claim"),
    sql.indexOf("create or replace function public.activate_paid_mentor_order")
  );

  for (const functionBody of [students, claims, review]) {
    assert.match(functionBody, /mentor\.owner_id = auth\.uid\(\)/);
    assert.doesNotMatch(functionBody, /mentor_is_admin/);
  }
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
});

test("mentor activation avoids entitlement id variable ambiguity", async () => {
  const sql = await read("supabase/migrations/202608040003_scope_personal_mentor_inbox.sql");
  const activation = sql.slice(sql.indexOf("create or replace function public.activate_paid_mentor_order"));
  assert.match(activation, /v_entitlement_id uuid/);
  assert.match(activation, /returning id into v_entitlement_id/);
  assert.match(activation, /values \(v_entitlement_id, new\.buyer_id, new\.mentor_id\)/);
  assert.doesNotMatch(activation, /\n\s*entitlement_id uuid;/);
});

test("messenger separates friend and teacher directories", async () => {
  const [member, repository, css] = await Promise.all([
    read("community/member-ui.js"),
    read("community/member-repository.js"),
    read("community/research-studio.css")
  ]);
  assert.match(member, /const friendTab = button\("好友", "is-active"\)/);
  assert.match(member, /const teacherTab = button\("老师"\)/);
  assert.doesNotMatch(member, /button\("分组"/);
  assert.match(member, /member-mentor-directory-section/);
  assert.match(member, /sectionTitle\("我的老师"/);
  assert.match(member, /sectionTitle\("我的学生"/);
  assert.match(repository, /listMentorAccess/);
  assert.match(css, /show-mentor-directory/);
});
