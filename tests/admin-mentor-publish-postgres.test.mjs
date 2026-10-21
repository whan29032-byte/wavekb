import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/202610220001_atomic_admin_mentor_publish.sql", import.meta.url), "utf8");
const ownerId = "11111111-1111-4111-8111-111111111111";
const secondOwnerId = "22222222-2222-4222-8222-222222222222";
const mentorId = "33333333-3333-4333-8333-333333333333";
const offerId = "44444444-4444-4444-8444-444444444444";

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.profiles (id uuid primary key);
    create table public.mentor_profiles (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid unique references public.profiles(id) on delete set null,
      display_name text not null check (char_length(display_name) between 2 and 40),
      headline text not null default '',
      bio text not null default '',
      avatar_url text,
      specialties text[] not null default '{}',
      active boolean not null default true,
      sort_order integer not null default 100,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.mentor_offers (
      id uuid primary key default gen_random_uuid(),
      mentor_id uuid not null references public.mentor_profiles(id) on delete cascade,
      name text not null,
      price_cents integer not null,
      currency text not null,
      duration_days integer not null,
      weekly_questions integer not null,
      active boolean not null default true,
      sort_order integer not null default 100,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create function public.mentor_is_admin() returns boolean language sql stable as $$ select true $$;
    create function public.wavekb_schema_version() returns text language sql stable as $$ select '202610190001'::text $$;
    insert into public.profiles(id) values ('${ownerId}'), ('${secondOwnerId}');
    insert into public.mentor_profiles(id, owner_id, display_name, active, sort_order)
      values ('${mentorId}', '${ownerId}', '旧导师', false, 80);
    insert into public.mentor_offers(id, mentor_id, name, price_cents, currency, duration_days, weekly_questions, active, sort_order)
      values ('${offerId}', '${mentorId}', '旧方案', 9900, 'USDT', 7, 1, false, 10);
  `);
  await db.exec(migration);
  return db;
}

async function publish(db, owner, displayName, offerActive = true) {
  const result = await db.query(`
    select public.admin_upsert_mentor_catalog_v2(
      p_owner_id => $1::uuid,
      p_display_name => $2,
      p_headline => '结构交易',
      p_bio => '只验证结构与风险边界',
      p_specialties => array['推动浪','调整浪']::text[],
      p_active => true,
      p_sort_order => 10,
      p_offer_name => '一对一复盘',
      p_price_cents => 29900,
      p_currency => 'usdt',
      p_duration_days => 30,
      p_weekly_questions => 3,
      p_offer_active => $3
    ) as value
  `, [owner, displayName, offerActive]);
  return result.rows[0].value;
}

test("atomic mentor publish reuses an existing owner and updates its first offer", async () => {
  const db = await createDatabase();
  try {
    const value = await publish(db, ownerId, "重新上架导师", true);
    assert.deepEqual(value, { mentor_id: mentorId, offer_id: offerId, reused_mentor: true });
    assert.deepEqual((await db.query("select display_name,active,sort_order from public.mentor_profiles where id=$1", [mentorId])).rows[0], {
      display_name: "重新上架导师", active: true, sort_order: 10,
    });
    assert.deepEqual((await db.query("select name,price_cents,currency,duration_days,weekly_questions,active from public.mentor_offers where id=$1", [offerId])).rows[0], {
      name: "一对一复盘", price_cents: 29900, currency: "USDT", duration_days: 30, weekly_questions: 3, active: true,
    });
    assert.equal((await db.query("select count(*)::int as count from public.mentor_profiles where owner_id=$1", [ownerId])).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from public.mentor_offers where mentor_id=$1", [mentorId])).rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("atomic mentor publish creates one catalog pair and preserves the requested offer state", async () => {
  const db = await createDatabase();
  try {
    const value = await publish(db, secondOwnerId, "新导师", false);
    assert.equal(value.reused_mentor, false);
    assert.ok(value.mentor_id);
    assert.ok(value.offer_id);
    assert.equal((await db.query("select active from public.mentor_profiles where id=$1", [value.mentor_id])).rows[0].active, true);
    assert.equal((await db.query("select active from public.mentor_offers where id=$1", [value.offer_id])).rows[0].active, false);
    assert.equal((await db.query("select public.wavekb_schema_version() as version")).rows[0].version, "202610220001");
    const signature = "public.admin_upsert_mentor_catalog_v2(uuid,uuid,uuid,text,text,text,text,text[],boolean,integer,text,integer,text,integer,integer,boolean)";
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as allowed", [signature])).rows[0].allowed, true);
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') as allowed", [signature])).rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

test("atomic mentor publish rejects an unknown owner without leaving partial rows", async () => {
  const db = await createDatabase();
  try {
    const before = (await db.query("select count(*)::int as count from public.mentor_profiles")).rows[0].count;
    await assert.rejects(publish(db, "99999999-9999-4999-8999-999999999999", "未知导师"), /mentor_owner_not_found/);
    assert.equal((await db.query("select count(*)::int as count from public.mentor_profiles")).rows[0].count, before);
  } finally {
    await db.close();
  }
});
