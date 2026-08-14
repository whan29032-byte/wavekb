import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Next homepage reads the managed X and Discord directory without demo records", async () => {
  const [page, repository] = await Promise.all([read("apps/web/src/app/page.tsx"), read("apps/web/src/lib/directory/server-repository.ts")]);
  assert.match(page, /listPublicDirectory/);
  assert.match(page, /X 波浪理论博主推荐/);
  assert.match(page, /Discord 波浪理论频道推荐/);
  assert.doesNotMatch(page, /Elliott Wave Forecast|fallbackResources/);
  assert.match(repository, /\/api\/directory/);
  assert.match(repository, /cache: "no-store"/);
});

test("knowledge images are locally published, audited and opened in an internal viewer", async () => {
  const [page, viewer, sync, audit] = await Promise.all([
    read("apps/web/src/app/knowledge/[id]/page.tsx"),
    read("apps/web/src/components/knowledge-image-viewer.tsx"),
    read("apps/web/scripts/sync-legacy-assets.mjs"),
    read("apps/web/scripts/check-knowledge-assets.mjs"),
  ]);
  assert.match(page, /NEXT_PUBLIC_KNOWLEDGE_ASSET_BASE_URL/);
  assert.doesNotMatch(page, /legacySiteUrl/);
  assert.match(viewer, /Escape/);
  assert.match(viewer, /onPointerMove/);
  assert.match(viewer, /MagnifyingGlassPlus/);
  for (const directory of ["source-pages", "figures", "figures-v10"]) assert.match(sync, new RegExp(directory));
  assert.match(audit, /Missing .* referenced knowledge assets/);
  assert.match(audit, /content-type/);
});

test("root-mounted messenger preserves real-data friend and independent chat state", async () => {
  const [layout, desktop, css, profileActions] = await Promise.all([
    read("apps/web/src/app/layout.tsx"),
    read("apps/web/src/components/social-desktop.tsx"),
    read("apps/web/src/components/social-desktop.module.css"),
    read("apps/web/src/components/member-profile-actions.tsx"),
  ]);
  assert.match(layout, /<SocialDesktop/);
  for (const contract of ["list_my_friendships", "list_my_conversations_v2", "list_my_mentor_access", "list_my_mentor_students", "respond_friend_request", "send_direct_message", "wavekb-member-presence"]) assert.match(desktop, new RegExp(contract));
  assert.match(desktop, /paste/);
  assert.match(desktop, /drop/);
  assert.match(desktop, /staged/);
  assert.match(css, /width:304px/);
  assert.match(css, /resize:both/);
  assert.match(css, /data-autohidden/);
  assert.match(profileActions, /wavekb:open-chat/);
});

test("unified nameplates and semantic theme tokens cover migrated Next surfaces", async () => {
  const [plate, css, layout] = await Promise.all([read("apps/web/src/components/nameplate.tsx"), read("apps/web/src/app/globals.css"), read("apps/web/src/app/layout.tsx")]);
  for (const style of ["blackgold", "platinum", "purplegold", "rainbow", "newyear"]) assert.match(css, new RegExp(`data-nameplate=\\"${style}\\"`));
  assert.match(plate, /identity-drive-wave/);
  for (const token of ["--background", "--surface-raised", "--sidebar", "--popover", "--foreground", "--muted-foreground", "--border", "--input", "--primary-hover", "--primary-selected", "--destructive", "--shadow-floating"]) assert.match(css, new RegExp(token));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(layout, /wavekb:appearance:v1/);
});

test("user points are managed with users rather than the reward catalog page", async () => {
  const [users, rewards] = await Promise.all([read("apps/web/src/app/admin/users/page.tsx"), read("apps/web/src/app/admin/rewards/page.tsx")]);
  assert.match(users, /AdminUserRewards/);
  assert.match(rewards, /用户积分调整已经归入/);
});
