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
  const [layout, desktop, drag, css, profileActions] = await Promise.all([
    read("apps/web/src/app/layout.tsx"),
    read("apps/web/src/components/social-desktop.tsx"),
    read("apps/web/src/hooks/use-floating-window-drag.ts"),
    read("apps/web/src/components/social-desktop.module.css"),
    read("apps/web/src/components/member-profile-actions.tsx"),
  ]);
  assert.match(layout, /<SocialDesktop/);
  for (const contract of ["readFriends", "runFriendAction", "list_my_mentor_access", "list_my_mentor_students", "list_my_mentor_payment_claims", "send_direct_message", "mark_conversation_read_v1", "wavekb-member-presence"]) assert.match(desktop, new RegExp(contract));
  assert.match(desktop, /搜索好友或 UID/);
  assert.match(desktop, /clampPanelCoordinates/);
  assert.match(desktop, /paste/);
  assert.match(desktop, /drop/);
  assert.match(desktop, /staged/);
  assert.match(desktop, /useFloatingWindowDrag/);
  for (const lifecycle of ["pointerup", "pointercancel", "lostpointercapture", "blur", "visibilitychange"]) assert.match(drag.toLowerCase(), new RegExp(lifecycle));
  assert.match(drag, /setPointerCapture/);
  assert.match(drag, /isInteractiveDragTarget/);
  assert.match(css, /width:304px/);
  assert.match(css, /resize:both/);
  assert.match(css, /data-autohidden/);
  assert.match(profileActions, /wavekb:open-chat/);
  assert.match(profileActions, /wavekb:open-friends/);
  assert.match(desktop, /完整管理 →/);
});

test("public member profiles are anonymous-readable while social actions still require login", async () => {
  const [page, repository, actions] = await Promise.all([
    read("apps/web/src/app/member/[uid]/page.tsx"),
    read("apps/web/src/lib/member/server-repository.ts"),
    read("apps/web/src/components/member-profile-actions.tsx"),
  ]);
  assert.match(page, /getOptionalActiveMember/);
  assert.doesNotMatch(page, /requireActiveMember/);
  assert.match(repository, /get_public_profiles/);
  assert.match(repository, /get_public_post_profiles/);
  assert.match(repository, /\.eq\("public_uid", uid\)/);
  assert.doesNotMatch(repository.slice(repository.indexOf("getMemberProfileByUid"), repository.indexOf("getMyProfile")), /email|points|private_entries|auth\.users/);
  assert.match(actions, /login\?next=/);
});

test("production deployment applies every migration newer than the live schema", async () => {
  const workflow = await read(".github/workflows/deploy-next-production.yml");
  const migrationStep = workflow.slice(workflow.indexOf("Apply production database migrations"), workflow.indexOf("Build the standalone application"));
  assert.match(migrationStep, /find supabase\/migrations/);
  assert.match(migrationStep, /migration_version > 10#\$schema_version/);
  assert.match(migrationStep, /--single-transaction/);
  assert.match(migrationStep, /test "\$deployed_version" = "\$latest_version"/);
  assert.doesNotMatch(migrationStep, /202608140\*\.sql/);
  assert.match(workflow, /DEPLOYMENT_VERSION/);
  assert.match(workflow, /gateway_health[\s\S]*?deployment/);
});

test("friendship reader migration advances the production schema marker", async () => {
  const migration = await read("supabase/migrations/202608210002_friendships_v2.sql");
  assert.match(migration, /create or replace function public\.list_my_friendships_v2\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.uid\(\) is not null/);
  assert.match(migration, /select '202608210002'::text/);
  assert.match(migration, /grant execute on function public\.wavekb_schema_version\(\) to anon, authenticated/);
});

test("floating friends stay on the profile while complete management uses one protected server boundary", async () => {
  const [page, directory, route, clientApi, loginRoute, accountNavigation, actions, acceptance] = await Promise.all([
    read("apps/web/src/app/friends/page.tsx"),
    read("apps/web/src/components/friend-directory.tsx"),
    read("apps/web/src/app/api/member/friends/route.ts"),
    read("apps/web/src/lib/member/friends-api-client.ts"),
    read("apps/web/src/app/api/auth/login/route.ts"),
    read("apps/web/src/components/account-navigation.tsx"),
    read("apps/web/src/components/member-profile-actions.tsx"),
    read("apps/web/e2e/member-shell.acceptance.spec.ts"),
  ]);
  assert.doesNotMatch(page, /requireActiveMember|listFriendships/);
  assert.match(page, /<FriendDirectory/);
  assert.match(directory, /readFriends\(\)/);
  assert.match(directory, /router\.replace\("\/login\?next=%2Ffriends"\)/);
  assert.match(clientApi, /fetch\(endpoint/);
  assert.match(clientApi, /method: "POST"/);
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /loadFriendships\(client\)/);
  for (const rpc of ["send_friend_request", "respond_friend_request", "open_direct_conversation", "search_profile_by_uid"]) assert.match(route, new RegExp(rpc));
  for (const field of ["route", "rpc", "status", "code", "message", "details", "hint", "authCookieCount"]) assert.match(route, new RegExp(field));
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(loginRoute, /return response/);
  assert.match(accountNavigation, /client\.auth\.getSession\(\)/);
  assert.match(actions, /wavekb:open-friends/);
  assert.doesNotMatch(actions.slice(actions.indexOf("if (actorId === profileId)"), actions.indexOf("async function toggleFollow")), /href="\/friends"/);
  assert.match(acceptance, /configure\(\{ retries: 0 \}\)/);
  assert.match(acceptance, /profileUrl/);
  assert.match(acceptance, /完整管理/);
  assert.match(acceptance, /data-load-state", "ready"/);
  assert.match(acceptance, /page\.reload\(\)/);
  assert.match(acceptance, /data-friend-count/);
});

test("unified nameplates and semantic theme tokens cover migrated Next surfaces", async () => {
  const [plate, css, layout] = await Promise.all([read("apps/web/src/components/nameplate.tsx"), read("apps/web/src/app/globals.css"), read("apps/web/src/app/layout.tsx")]);
  for (const style of ["premium", "blackgold", "platinum", "purplegold", "rainbow", "newyear"]) assert.match(css, new RegExp(`data-nameplate=\\"${style}\\"`));
  assert.match(plate, /identity-drive-wave/);
  for (const token of ["--background", "--surface-raised", "--sidebar", "--popover", "--foreground", "--muted-foreground", "--border", "--input", "--primary-hover", "--primary-selected", "--destructive", "--shadow-floating"]) assert.match(css, new RegExp(token));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /identity-border-flow/);
  assert.match(css, /identity-shine/);
  assert.match(css, /\.identity-avatar-frame\)\[data-nameplate=/);
  assert.match(layout, /wavekb:appearance:v1/);
});

test("the production member page uses the compact cross-cover profile hero", async () => {
  const [page, css, actions] = await Promise.all([
    read("apps/web/src/app/member/[uid]/page.tsx"),
    read("apps/web/src/app/globals.css"),
    read("apps/web/src/components/member-profile-actions.tsx"),
  ]);
  for (const marker of ["data-profile-hero", "data-profile-cover", "data-profile-avatar", "data-profile-identity", "data-profile-actions"]) assert.match(page, new RegExp(marker));
  assert.match(css, /\.profile-hero-cover \{ height: 12\.5rem/);
  assert.match(css, /\.identity-avatar-frame\[data-size="large"\] \{ --avatar-size: 7rem/);
  const ownActions = actions.slice(actions.indexOf("if (actorId === profileId)"), actions.indexOf("async function toggleFollow"));
  assert.match(ownActions, /编辑资料[\s\S]*?我的好友[\s\S]*?交易工作台/);
  assert.doesNotMatch(ownActions, /积分商城|href="\/rewards"/);
});

test("research posts use reusable media, lightbox and immutable server-timed timeline infrastructure", async () => {
  const [page, composer, media, mediaParser, lightbox, timeline, repository, migration] = await Promise.all([
    read("apps/web/src/app/community/post/[id]/page.tsx"),
    read("apps/web/src/components/post-composer.tsx"),
    read("apps/web/src/components/research-media.tsx"),
    read("apps/web/src/lib/community/external-media.ts"),
    read("apps/web/src/components/research-lightbox.tsx"),
    read("apps/web/src/components/research-timeline.tsx"),
    read("apps/web/src/lib/community/client-repository.ts"),
    read("supabase/migrations/202608210001_research_timelines_media.sql"),
  ]);
  for (const component of ["ResearchAuthor", "ResearchBody", "ResearchLightbox", "ResearchMedia", "ResearchTimeline"]) assert.match(page, new RegExp(component));
  assert.match(composer, /MAX_EXTERNAL_REFERENCES/);
  assert.match(composer, /媒体与外部引用/);
  assert.match(mediaParser, /youtube-nocookie/);
  assert.match(media, /platform\.twitter\.com\/widgets\.js/);
  assert.match(media, /noopener noreferrer/);
  assert.match(lightbox, /Escape/);
  assert.match(lightbox, /ArrowLeft/);
  assert.match(lightbox, /MagnifyingGlassPlus/);
  assert.match(timeline, /ResearchTimelineComposer/);
  assert.match(repository, /append_research_timeline_node/);
  assert.match(migration, /create table if not exists public\.research_timeline_nodes/);
  assert.match(migration, /subject_type in \('post', 'private_entry'\)/);
  assert.match(migration, /created_at timestamptz not null default now\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /authors add references to their posts/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create or replace function public.append_research_timeline_node")), /p_created_at/);
});

test("user points are managed with users rather than the reward catalog page", async () => {
  const [users, rewards] = await Promise.all([read("apps/web/src/app/admin/users/page.tsx"), read("apps/web/src/app/admin/rewards/page.tsx")]);
  assert.match(users, /AdminUserRewards/);
  assert.match(rewards, /用户积分调整已经归入/);
});

test("site-wide rewards and private workbench use distinct navigation levels", async () => {
  const [header, account, actions] = await Promise.all([
    read("apps/web/src/components/site-header.tsx"),
    read("apps/web/src/components/account-navigation.tsx"),
    read("apps/web/src/components/member-profile-actions.tsx"),
  ]);
  assert.match(header, /href="\/rewards"[\s\S]*?积分商城/);
  assert.doesNotMatch(header, /href="\/workbench"/);
  assert.doesNotMatch(account, /href="\/(?:rewards|workbench)"/);
  const ownActions = actions.slice(actions.indexOf("if (actorId === profileId)"), actions.indexOf("async function toggleFollow"));
  assert.match(ownActions, /编辑资料[\s\S]*?我的好友[\s\S]*?交易工作台/);
  assert.doesNotMatch(ownActions, /href="\/rewards"|积分商城/);
  assert.match(ownActions, /grid-cols-1[\s\S]*?min-\[28rem\]:grid-cols-2[\s\S]*?sm:flex/);
});

test("post deletion is owner-scoped through the authenticated service gateway", async () => {
  const [client, route, server, gateway] = await Promise.all([
    read("apps/web/src/lib/community/client-repository.ts"),
    read("apps/web/src/app/api/community/posts/[id]/delete/route.ts"),
    read("ai-gateway/src/server.ts"),
    read("ai-gateway/src/routes/gateway-api.ts"),
  ]);
  assert.match(client, /\/api\/community\/posts\/\$\{encodeURIComponent\(post\.id\)\}\/delete/);
  assert.doesNotMatch(client.slice(client.indexOf("export async function deletePost"), client.indexOf("export async function addPostComment")), /from\("posts"\)\.delete/);
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /gatewayRequestOrigin/);
  assert.match(server, /deleteOwnPost/);
  const deletion = gateway.slice(gateway.indexOf("async deleteOwnPost"), gateway.indexOf("async dashboard"));
  assert.match(deletion, /author_id=eq\.\$\{encodedActorId\}/);
  assert.match(deletion, /method: "DELETE"/);
  assert.match(deletion, /return=representation/);
  assert.doesNotMatch(deletion, /delete.*profiles|auth\.users/i);
});
