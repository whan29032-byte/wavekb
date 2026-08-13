import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
const workbenchCore = require(fileURLToPath(new URL("../workbench/workbench-core.js", import.meta.url)));
const memberCore = require(fileURLToPath(new URL("../community/member-core.js", import.meta.url)));

test("profile hero removes the redundant archive label and moves points under avatar", async () => {
  const member = await read("community/member-ui.js");
  assert.doesNotMatch(member, /member-eyebrow", "私人研究档案/);
  assert.match(member, /member-profile-avatar-stack/);
  assert.match(member, /avatarStack\.appendChild\(pointsLink\)/);
  assert.match(member, /member-store-button/);
});

test("private record management lives inside the trading workbench", async () => {
  const [member, workbench, css, preview, main] = await Promise.all([
    read("community/member-ui.js"),
    read("workbench/workbench-ui.js"),
    read("workbench/workbench.css"),
    read("previews/social-experience-preview.html"),
    read("index.html")
  ]);
  assert.match(member, /primaryAction: "交易工作台"/);
  assert.match(member, /\["review", "journal", "draft"\]\.includes\(route\.view\)/);
  assert.doesNotMatch(member, /aria-label", "记录筛选/);
  const actions = member.slice(member.indexOf('const actions = element("div", "member-primary-actions")'), member.indexOf('const stats = element("div", "member-profile-statbar")'));
  assert.doesNotMatch(actions, /写交易日记|写研究草稿/);
  assert.match(workbench, /workbench-record-center/);
  assert.match(workbench, /\["all", "全部记录"\]/);
  assert.match(workbench, /#space=entry&entry=new-review/);
  assert.match(workbench, /#space=entry&entry=new-journal/);
  assert.match(workbench, /#space=entry&entry=new-draft/);
  assert.match(css, /\.workbench-record-filters\s*\{[\s\S]*?grid-template-columns: repeat\(4/);
  assert.match(preview, />交易工作台<\/a>/);
  assert.doesNotMatch(preview.slice(preview.indexOf('<section class="preview-block" id="profile">'), preview.indexOf('<section class="preview-block" id="workbench">')), /member-tabs|>新建复盘</);
  assert.match(main, /memberRepository,/);
  assert.match(main, /wavekb-workbench-ai-20260803-2/);
});

test("workbench route preserves the records panel and selected record type", () => {
  const route = workbenchCore.workbenchRouteFromHash(
    "#workbench=new&step=4&panel=records&records=journal"
  );
  assert.deepEqual(route, {
    kind: "workbench",
    analysisId: "new",
    step: 4,
    panel: "records",
    recordView: "journal"
  });
  assert.equal(
    workbenchCore.hashForWorkbenchRoute(route),
    "#workbench=new&step=4&panel=records&records=journal"
  );
});

test("UID search, friend cards and chat headers link to a member public profile", async () => {
  const member = await read("community/member-ui.js");
  assert.match(member, /async function renderPublicProfile/);
  assert.match(member, /view: "person"/);
  assert.match(member, /member-friend-profile-link/);
  assert.match(member, /member-chat-profile-link/);
  assert.match(member, /repository\.listPublicPostsByAuthor/);
});

test("public profile uses a compact cover identity and synchronized premium frame", async () => {
  const [member, css, preview, crown] = await Promise.all([
    read("community/member-ui.js"),
    read("community/taste-polish.css"),
    read("previews/social-experience-preview.html"),
    read("community/blackgold-motive-wave.svg")
  ]);
  assert.match(member, /member-public-profile-cover/);
  assert.match(member, /member-public-profile-summary/);
  assert.match(member, /member-public-profile-action-stack/);
  assert.match(member, /title\.classList\.add\("member-public-profile-title"\)/);
  assert.match(member, /copy\.append\(title, name,/);
  assert.match(member, /member-avatar-frame/);
  assert.match(member, /\[\["公开内容", posts\.length\], \["参与板块", boardCount\], \["关注市场", marketCount\]\]/);
  assert.match(css, /\.member-avatar-frame\.is-premium[\s\S]*?bedra-avatar-frame/);
  assert.match(css, /\.member-uid-nameplate\.is-premium \.member-liang-icon[\s\S]*?clip-path: polygon/);
  assert.doesNotMatch(css, /content: "♛"/);
  assert.match(css, /\.member-uid-nameplate\.is-premium::before,[\s\S]*?\.community-uid-badge\.is-pretty::before[\s\S]*?blackgold-motive-wave\.svg/);
  assert.match(css, /\.member-uid-nameplate\.is-premium::after,[\s\S]*?\.community-uid-badge\.is-pretty::after[\s\S]*?display: none/);
  assert.match(crown, /金色驱动浪/);
  assert.match(crown, /M2 16 7\.5 10\.5 10\.5 13\.2 17\.2 4\.2 21\.2 8\.2 29\.5 1\.6/);
  assert.match(css, /\.member-public-profile-cover/);
  assert.match(css, /\.member-public-profile-summary/);
  assert.match(preview, /member-public-profile-overview/);
  assert.doesNotMatch(preview, /03 PUBLIC PROFILE/);
});

test("public profile loads only published posts and never private entries", async () => {
  const repository = await read("community/member-repository.js");
  assert.match(repository, /listPublicPostsByAuthor/);
  assert.match(repository, /\.eq\("status", "published"\)/);
  const method = repository.slice(
    repository.indexOf("async listPublicPostsByAuthor"),
    repository.indexOf("async getPublicPost")
  );
  assert.doesNotMatch(method, /private_entries/);
});

test("other user profiles expose follow and friendship-aware primary actions", async () => {
  const [member, repository, css, preview, migration] = await Promise.all([
    read("community/member-ui.js"),
    read("community/member-repository.js"),
    read("community/taste-polish.css"),
    read("previews/social-experience-preview.html"),
    read("supabase/migrations/202608030007_profile_follows.sql")
  ]);
  assert.match(member, /isFollowing \? "已关注" : "关注"/);
  assert.match(member, /connection && connection\.status === "accepted"[\s\S]*?button\("发起会话"/);
  assert.match(member, /button\("添加好友", "btn btn-primary"\)/);
  assert.match(repository, /async isFollowing\(userId, targetId\)/);
  assert.match(repository, /async followProfile\(userId, targetId\)/);
  assert.match(repository, /async unfollowProfile\(userId, targetId\)/);
  assert.match(css, /\.member-public-profile-follow\[aria-pressed="true"\]/);
  const publicPreview = preview.slice(preview.indexOf('id="public-profile"'), preview.indexOf('id="rewards"'));
  assert.match(publicPreview, />关注<\/button>/);
  assert.match(publicPreview, />添加好友<\/button>/);
  assert.doesNotMatch(publicPreview, /编辑个人资料|回到个人空间/);
  assert.match(migration, /create table if not exists public\.profile_follows/);
  assert.match(migration, /follower_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
});

test("messenger includes a sticker picker and token-safe rendering", async () => {
  const [member, css] = await Promise.all([
    read("community/member-ui.js"),
    read("community/taste-polish.css")
  ]);
  assert.match(member, /const stickerCatalog/);
  assert.match(member, /\[\[sticker:/);
  assert.match(member, /member-sticker-panel/);
  assert.match(member, /member-message-sticker/);
  assert.match(css, /\.member-sticker-option/);
  assert.match(css, /\.member-message-sticker/);
});

test("friends use a compact desktop directory with independent chat windows", async () => {
  const [member, repository, css, polish, messengerCss, preview, migration] = await Promise.all([
    read("community/member-ui.js"),
    read("community/member-repository.js"),
    read("community/research-studio.css"),
    read("community/taste-polish.css"),
    read("community/messenger-desktop.css"),
    read("previews/social-experience-preview.html"),
    read("supabase/migrations/202608030008_mentor_student_directory.sql")
  ]);
  assert.match(member, /btn btn-ghost member-friends-button/);
  assert.match(member, /member-messenger-overlay/);
  assert.match(member, /member-messenger-window/);
  assert.match(member, /const messengerChatWindows = new Map\(\)/);
  assert.match(member, /function installMessengerWindow\(panel, options = \{\}\)/);
  assert.match(member, /async function openDesktopChatWindow\(conversationId, profile/);
  assert.match(member, /wavekb-chat-window/);
  const messagesBody = member.slice(member.indexOf("async function renderMessages"), member.indexOf("function rewardActionLabel"));
  assert.ok(
    messagesBody.indexOf("const hasActiveConversation") < messagesBody.indexOf("member-messenger-window"),
    "conversation state must be initialized before the messenger window class is rendered"
  );
  assert.match(member, /ensureMessengerDesktop\(\)\.appendChild\(shell\)/);
  assert.doesNotMatch(
    messagesBody,
    /contentHost\.replaceChildren\(shell\)/
  );
  assert.match(member, /"新朋友"/);
  assert.match(member, /friendSearchPanel\.hidden = true/);
  assert.match(member, /setFriendSearchPanel\(friendSearchPanel\.hidden\)/);
  assert.match(member, /friendSearchPanel\.appendChild\(pendingSection\)/);
  assert.doesNotMatch(member, /sidebar\.appendChild\(pendingSection\)/);
  assert.doesNotMatch(member, /notificationTotal = unreadTotal \+ pending\.length/);
  const notificationBody = messagesBody.slice(
    messagesBody.indexOf('const notificationList'),
    messagesBody.indexOf('submittedClaims.forEach')
  );
  assert.doesNotMatch(notificationBody, /pending\.forEach/);
  assert.match(member, /"消息通知"/);
  assert.match(member, /member-chat-notification-center/);
  assert.match(member, /setNotificationCenter\(notificationCenter\.hidden\)/);
  assert.match(member, /sidebarTopRow\.append\(element\("strong", "", "好友"\)\)/);
  assert.doesNotMatch(member, /sidebarTopRow\.append\(element\("strong", "", "好友"\), addToggle\)/);
  assert.doesNotMatch(messagesBody, /member-chat-collapse-toggle/);
  assert.doesNotMatch(messagesBody, /recentList\.hidden = true/);
  assert.match(member, /const directoryFriendMap = new Map/);
  assert.match(member, /member-friend-section-title/);
  assert.doesNotMatch(messagesBody, /friendSectionTitle\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(member, /contact\.addEventListener\("dblclick"/);
  assert.match(member, /profileNavigateTimer = win\.setTimeout/);
  assert.match(member, /event\.stopImmediatePropagation\(\)/);
  assert.match(member, /const screenshotButton = button\("截图"/);
  assert.doesNotMatch(member, /const imageButton = button\("图片"/);
  assert.doesNotMatch(member, /const fileButton = button\("文件"/);
  assert.match(member, /function firstImageFile\(transfer\)/);
  assert.match(member, /composer\.addEventListener\("dragover"/);
  assert.match(member, /composer\.addEventListener\("drop"/);
  assert.match(messengerCss, /\.wavekb-chat-pending\[hidden\]/);
  assert.match(member, /wavekb-chat-message-avatar/);
  assert.match(member, /saveMessengerWindowState\(`chat:\$\{id\}`, \{pinned: pressed\}\)/);
  assert.doesNotMatch(member, /sectionTitle\("其他好友"/);
  assert.match(member, /sectionTitle\("我的学生"/);
  assert.match(member, /repository\.sendMentorMessage\(route\.mentorThreadId, body\)/);
  assert.match(member, /repository\.subscribePresence/);
  assert.match(repository, /subscribePresence\(userId, onChange\)/);
  assert.match(repository, /listMentorStudents/);
  assert.match(css, /\.member-messenger-overlay/);
  assert.match(css, /\.member-chat-directory-tabs/);
  assert.match(polish, /\.member-messenger-window[\s\S]*?background: #ffffff/);
  assert.match(polish, /Messenger desktop app:[\s\S]*?\.member-messenger-overlay \{[\s\S]*?background: transparent/);
  assert.match(polish, /\.member-messenger-window \{[\s\S]*?width: min\(24\.5rem/);
  assert.match(polish, /\.member-messenger-window\.has-conversation \{[\s\S]*?width: min\(50rem/);
  assert.match(polish, /Messenger layout repair:[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(polish, /\.member-message-bubble time\.member-message-time \{[\s\S]*?font-size: \.5rem !important/);
  assert.match(member, /element\("time", "member-message-time", messageTime\(message\.created_at\)\)/);
  assert.doesNotMatch(messagesBody, /button\("刷新", "btn btn-ghost member-chat-refresh"\)/);
  assert.match(member, /member-sticker-panel-close/);
  assert.match(member, /const body = pendingStickerBody \|\| messageInput\.value\.trim\(\)/);
  assert.match(member, /stageSticker\(`\[\[sticker:/);
  const stickerSelectionBody = messagesBody.slice(
    messagesBody.indexOf('stickerPanel.addEventListener("click"'),
    messagesBody.indexOf("loadCustomStickers();")
  );
  assert.doesNotMatch(stickerSelectionBody, /composer\.requestSubmit\(\)/);
  assert.match(member, /doc\.addEventListener\("pointerdown", dismissStickerPanel\)/);
  assert.match(member, /messengerReturnHash/);
  assert.match(member, /history\.replaceState/);
  assert.match(polish, /\.member-messenger-window \.member-messenger:not\(\.has-conversation\)/);
  assert.match(polish, /Messenger density repair:[\s\S]*?\.member-messenger-window:not\(\.has-conversation\) \{[\s\S]*?height: auto;[\s\S]*?min-height: 0;/);
  assert.match(polish, /Friend directory v6:[\s\S]*?\.member-messenger-window\.is-directory-view \{[\s\S]*?width: min\(24\.5rem[\s\S]*?height: auto !important/);
  assert.match(polish, /\.member-messenger-window\.is-directory-view \.member-chat-sidebar[\s\S]*?width: 100% !important/);
  assert.match(messengerCss, /\.wavekb-friend-panel \{/);
  assert.match(messengerCss, /width: 560px !important/);
  assert.match(messengerCss, /\.wavekb-chat-window \{/);
  assert.match(messengerCss, /\.wavekb-friend-panel\[data-dock="right"\]\.is-auto-hidden/);
  assert.match(messengerCss, /\.wavekb-messenger-taskbar \{/);
  assert.match(member, /messenger-window-state:v4/);
  assert.match(member, /width: 960/);
  assert.match(member, /height: 780/);
  assert.match(member, /width: 560/);
  assert.match(member, /height: 720/);
  assert.match(messengerCss, /--window-bg:/);
  assert.match(messengerCss, /--message-own-bg:/);
  assert.match(messengerCss, /--input-placeholder:/);
  assert.match(member, /button\("聊天", "member-friend-chat-button"\)/);
  assert.match(member, /if \(!disposeOptions\.preserveMessenger\) resetFloatingMessenger\(\)/);
  assert.match(member, /if \(messageAvatar\) row\.append\(messageAvatar, bubble\)/);
  assert.match(member, /else row\.appendChild\(bubble\)/);
  assert.match(messengerCss, /\.wavekb-chat-message\.is-mine \{[\s\S]*?justify-content: flex-start/);
  const [indexHtml, previewHtml] = await Promise.all([
    read("index.html"),
    read("elliott-wave-preview.html")
  ]);
  for (const html of [indexHtml, previewHtml]) {
    assert.match(html, /memberUI\.dispose\(\{preserveMessenger: true\}\)/);
    assert.match(html, /wavekb-ui-system-20260812-2/);
  }
  assert.match(preview, /preview-messenger-window/);
  assert.match(preview, /#friends:target\s*\{/);
  assert.match(preview, />我的学生</);
  assert.match(migration, /create or replace function public\.list_my_mentor_students/);
  assert.match(migration, /mentor\.owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
  const mentorRoute = memberCore.memberRouteFromHash("#space=messages&student=thread-123");
  assert.equal(mentorRoute.mentorThreadId, "thread-123");
  assert.equal(memberCore.hashForMemberRoute(mentorRoute), "#space=messages&student=thread-123");
});

test("reward store has a safe authenticated leaderboard", async () => {
  const [member, repository, sql, studioCss, appearanceCss, polishCss] = await Promise.all([
    read("community/member-ui.js"),
    read("community/member-repository.js"),
    read("supabase/migrations/202608030006_reward_leaderboard.sql"),
    read("community/research-studio.css"),
    read("community/appearance.css"),
    read("community/taste-polish.css")
  ]);
  assert.match(member, /积分排行榜/);
  const leaderboardHeading = member.slice(
    member.indexOf('const leaderboardHead = element("header", "member-reward-section-head")'),
    member.indexOf('const leaderboardList = element("div", "member-leaderboard-list")')
  );
  assert.doesNotMatch(leaderboardHeading, /研究积分/);
  assert.match(member, /"kb-breadcrumb-separator"/);
  assert.match(member, /"kb-breadcrumb-current"/);
  assert.match(studioCss, /--reward-hero-heading:\s*#f8fafc/);
  assert.match(appearanceCss, /\.member-rewards-hero[^{]*h1[\s\S]*?var\(--reward-hero-heading\) !important/);
  assert.match(appearanceCss, /\.member-rewards-hero \.text-muted[\s\S]*?var\(--reward-hero-body\) !important/);
  assert.match(appearanceCss, /-webkit-text-fill-color:\s*var\(--reward-hero-heading\) !important/);
  assert.match(appearanceCss, /\.member-leaderboard-section \.member-eyebrow[\s\S]*?display:\s*none !important/);
  assert.match(polishCss, /\.kb-breadcrumb-list a[\s\S]*?text-decoration:\s*none/);
  assert.match(repository, /list_reward_leaderboard/);
  assert.match(sql, /where auth\.uid\(\) is not null/);
  assert.match(sql, /grant execute on function public\.list_reward_leaderboard\(integer\) to authenticated/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
});

test("the local preview uses the current UI-system cache marker", async () => {
  const [main, preview] = await Promise.all([
    read("index.html"), read("elliott-wave-preview.html")
  ]);
  for (const html of [main, preview]) {
    assert.match(html, /wavekb-ui-system-20260812-2/);
  }
});

test("AI control center combines personal connections with the admin shortcut", async () => {
  const [main, member, workbench, userAICore, userAI, admin] = await Promise.all([
    read("index.html"),
    read("community/member-ui.js"),
    read("workbench/workbench-ui.js"),
    read("community/user-ai-core.js"),
    read("community/user-ai-ui.js"),
    read("community/ai-admin-ui.js")
  ]);
  assert.doesNotMatch(main, /data-ai-admin-route/);
  assert.doesNotMatch(member, /label: "AI 控制中心"/);
  assert.match(workbench, /#workbench=new&step=0&panel=ai/);
  assert.match(workbench, /"AI 模型"/);
  assert.match(userAICore, /embeddedInWorkbench: true/);
  assert.match(userAI, /function workbenchNav\(\)/);
  assert.doesNotMatch(member, /label: "我的 AI 接口"/);
  assert.match(userAI, /actor\.role === "admin"/);
  assert.match(userAI, /adminSettings\.href = "#ai-admin=overview"/);
  assert.match(admin, /homeLink\.href = "#space=home"/);
});

test("personal space uses one compact vertical action stack", async () => {
  const [member, preview] = await Promise.all([
    read("community/member-ui.js"),
    read("previews/social-experience-preview.html")
  ]);
  const actions = member.slice(
    member.indexOf('const actions = element("div", "member-primary-actions")'),
    member.indexOf('const stats = element("div", "member-profile-statbar")')
  );
  assert.match(actions, /"我的好友"[\s\S]*?privateHomeCopy\(\)\.primaryAction[\s\S]*?"积分商城"/);
  assert.doesNotMatch(actions, /AI 控制中心|积分排行榜/);
  const profile = preview.slice(
    preview.indexOf('<section class="preview-block" id="profile">'),
    preview.indexOf('<section class="preview-block" id="workbench">')
  );
  assert.match(profile, />我的好友<[\s\S]*?>交易工作台<[\s\S]*?>积分商城</);
  assert.doesNotMatch(profile, /member-tool-dock|AI 控制中心|积分排行榜/);
});
