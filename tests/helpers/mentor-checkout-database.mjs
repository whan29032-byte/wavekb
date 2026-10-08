import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const checkoutIds = {
  buyer: "11111111-1111-4111-8111-111111111111", owner: "22222222-2222-4222-8222-222222222222",
  mentor: "33333333-3333-4333-8333-333333333333", offer: "44444444-4444-4444-8444-444444444444",
  method: "55555555-5555-4555-8555-555555555555", request: "66666666-6666-4666-8666-666666666666",
  other: "77777777-7777-4777-8777-777777777777", request2: "88888888-8888-4888-8888-888888888888",
};

export async function checkoutMigration(name) {
  return readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
}

export async function setCheckoutActor(database, actor) {
  await database.query("select set_config('test.actor', $1, false)", [actor || ""]);
}

export async function createCheckoutDatabase() {
  const database = new PGlite();
  try {
    await database.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key, public_uid integer, display_name text, avatar_url text,
        role text default 'user', account_status text default 'active', bio text default '', display_title text default '', nameplate_style text default 'classic');
      create table public.posts(id uuid primary key);
      insert into auth.users values ('${checkoutIds.buyer}', now()), ('${checkoutIds.owner}', now()), ('${checkoutIds.other}', now());
      insert into public.profiles(id, public_uid, display_name) values
        ('${checkoutIds.buyer}', 11111, '验收学员'), ('${checkoutIds.owner}', 22222, '验收导师'), ('${checkoutIds.other}', 33333, '其他用户');`);
    for (const name of ["202607310002_mentor_tutoring.sql", "202608040001_tv_mentor_manual_payments.sql", "202608040002_mentor_usdt.sql", "202608040003_scope_personal_mentor_inbox.sql"]) {
      await database.exec(await checkoutMigration(name));
    }
    const enforcement = await checkoutMigration("202608140001_account_enforcement.sql");
    await database.exec(enforcement.match(/create or replace function public\.account_is_active\(\)[\s\S]+?\$\$;/)[0]);
    await database.exec(await checkoutMigration("202610080002_mentor_checkout_recovery.sql"));
    await database.exec(`insert into public.mentor_profiles(id, owner_id, display_name, active) values ('${checkoutIds.mentor}', '${checkoutIds.owner}', '验收导师', true);
      insert into public.mentor_offers(id, mentor_id, name, price_cents, duration_days, weekly_questions) values ('${checkoutIds.offer}', '${checkoutIds.mentor}', '30 天辅导', 10000, 30, 3);
      insert into public.mentor_payment_methods(id, mentor_id, kind, label, account_value) values ('${checkoutIds.method}', '${checkoutIds.mentor}', 'binance', '验收 UID', '123456789');`);
    await setCheckoutActor(database, checkoutIds.buyer);
    return database;
  } catch (error) { await database.close(); throw error; }
}

export const checkoutQuote = { price_cents: 10000, currency: "USDT", duration_days: 30, weekly_questions: 3 };

export async function submitCheckout(database, requestId = checkoutIds.request, note = "test-only declaration", quote = checkoutQuote) {
  return (await database.query("select public.submit_manual_mentor_payment($1, $2, $3, $4, $5::jsonb) as receipt", [checkoutIds.offer, checkoutIds.method, note, requestId, JSON.stringify(quote)])).rows[0].receipt;
}
