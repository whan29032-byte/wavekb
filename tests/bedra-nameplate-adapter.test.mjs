import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("all BEDRA styles are registered in member and community renderers", async () => {
  const [member, community] = await Promise.all([
    read("community/member-ui.js"),
    read("community/community-ui.js")
  ]);
  for (const style of ["blackgold", "rainbow", "newyear", "platinum", "purplegold"]) {
    assert.match(member, new RegExp(`"${style}"`));
    assert.match(community, new RegExp(`"${style}"`));
  }
});

test("premium UID rendering includes the marker and accessible label", async () => {
  const member = await read("community/member-ui.js");
  assert.match(member, /premium\s*\?\s*`炫彩铭牌 UID/);
  assert.match(member, /if \(premium\)/);
  assert.match(member, /is-premium/);
});

test("header account reuses the profile nameplate style and refreshes after changes", async () => {
  const [auth, community, member] = await Promise.all([
    read("community/community-auth.js"),
    read("community/community-ui.js"),
    read("community/member-ui.js")
  ]);
  assert.match(auth, /select\("id,public_uid,display_name,role,nameplate_style"\)/);
  assert.match(auth, /nameplateStyle: profile\.nameplate_style \|\| "classic"/);
  assert.match(auth, /async refreshActor\(\)/);
  assert.match(community, /profileUidNameplate\(\{[\s\S]*?nameplate_style: actor\.nameplateStyle/);
  assert.doesNotMatch(community, /community-uid-number`, `UID/);
  assert.match(member, /repository\.equipNameplate[\s\S]*?auth\.refreshActor/);
});

test("marketplace sells nameplates while profile editor manages owned styles", async () => {
  const member = await read("community/member-ui.js");
  const rewards = member.slice(
    member.indexOf("async function renderRewards"),
    member.indexOf("async function renderProfile")
  );
  const profile = member.slice(
    member.indexOf("async function renderProfile"),
    member.indexOf("async function renderEntryForm")
  );
  assert.doesNotMatch(rewards, /member-owned-nameplate-list|立即佩戴/);
  assert.match(rewards, /已拥有/);
  assert.match(rewards, /已佩戴/);
  assert.match(profile, /member-owned-nameplate-list/);
  assert.match(profile, /repository\.equipNameplate/);
  assert.match(profile, /切换中/);
  assert.match(profile, /有效至/);
  assert.match(profile, /applyPreviewNameplate/);
});

test("repository exposes the Supabase equip RPC", async () => {
  const repository = await read("community/member-repository.js");
  assert.match(repository, /equip_my_nameplate/);
  assert.match(repository, /p_entitlement/);
});

test("database migration preserves reward tables and adds entitlement ownership", async () => {
  const sql = await read("supabase/migrations/202608030005_bedra_nameplates.sql");
  assert.match(sql, /create table if not exists public\.user_nameplates/);
  assert.match(sql, /unique \(user_id, product_id\)/);
  assert.match(sql, /user_nameplates_one_equipped_idx/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
});

test("purchase, equip and admin grant functions are included", async () => {
  const sql = await read("supabase/migrations/202608030005_bedra_nameplates.sql");
  for (const fn of [
    "redeem_reward_product",
    "equip_my_nameplate",
    "admin_grant_nameplate",
    "admin_revoke_nameplate",
    "admin_list_nameplate_entitlements"
  ]) assert.match(sql, new RegExp(`function public\\.${fn}`));
});

test("entitlements have duration and expiry validation", async () => {
  const sql = await read("supabase/migrations/202608030005_bedra_nameplates.sql");
  assert.match(sql, /duration_days/);
  assert.match(sql, /expires_at <= now\(\)/);
  assert.match(sql, /nameplate_expired/);
});

test("five nameplate products have the BEDRA prices", async () => {
  const sql = await read("supabase/migrations/202608030005_bedra_nameplates.sql");
  for (const price of [3000, 1800, 1600, 1200, 2200]) {
    assert.match(sql, new RegExp(`\\b${price}\\b`));
  }
});

test("admin can configure duration and grant a product", async () => {
  const admin = await read("admin/admin-ui.js");
  assert.match(admin, /铭牌有效期（天）/);
  assert.match(admin, /admin_grant_nameplate/);
  assert.match(admin, /admin_revoke_nameplate/);
});

test("nameplate motion is text-only and honors reduced motion", async () => {
  const [base, polish] = await Promise.all([
    read("community/community.css"),
    read("community/taste-polish.css")
  ]);
  assert.match(base, /member-nameplate-unified-flow/);
  assert.match(polish, /bedra-unified-flow/);
  assert.match(polish, /prefers-reduced-motion: reduce/);
  assert.match(polish, /animation: none !important/);
});

test("reward center remains responsive on phone widths", async () => {
  const css = await read("community/research-studio.css");
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /member-owned-nameplate \{ grid-template-columns: 1fr/);
});

test("all entry documents pin explicit cache-busted asset versions", async () => {
  const [main, preview, socialPreview, admin] = await Promise.all([
    read("index.html"),
    read("elliott-wave-preview.html"),
    read("previews/social-experience-preview.html"),
    read("admin/index.html")
  ]);
  for (const html of [main, preview]) assert.match(html, /wavekb-ui-system-20260812-2/);
  assert.match(socialPreview, /wavekb-admin-audit-20260810-1/);
  assert.match(admin, /admin-audit-20260810-3/);
});
