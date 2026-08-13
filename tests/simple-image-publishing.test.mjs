import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const attachments = require("../community/image-attachments.js");
const communityCore = require("../community/community-core.js");
const {createMemberRepository} = require("../community/member-repository.js");

const memberUI = fs.readFileSync(new URL("../community/member-ui.js", import.meta.url), "utf8");
const communityUI = fs.readFileSync(new URL("../community/community-ui.js", import.meta.url), "utf8");
const memberRepository = fs.readFileSync(new URL("../community/member-repository.js", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../supabase/migrations/202608040004_private_entry_images.sql", import.meta.url),
  "utf8"
);

test("simple publishing accepts an image-backed short description", () => {
  const result = communityCore.validatePost({
    board: "idea_sharing",
    title: "浪四是否完成",
    body: "请看图",
    mode: "simple",
    imageCount: 2
  });
  assert.equal(result.ok, true);
});

test("image attachment validation protects type, size and count", () => {
  assert.equal(attachments.validateFile({type: "image/png", size: 1200}), "");
  assert.match(attachments.validateFile({type: "image/gif", size: 1200}), /JPG/);
  assert.match(attachments.validateFile({type: "image/png", size: 11 * 1024 * 1024}), /10 MiB/);
  assert.equal(attachments.MAX_IMAGES, 9);
});

test("private reviews and journals default to simple records with pasted multi-images", () => {
  assert.match(memberUI, /button\("简易记录"/);
  assert.match(memberUI, /button\("专业复盘"/);
  assert.match(memberUI, /imagePicker\.bindPasteTarget\(form\)/);
  assert.match(memberUI, /files: imagePicker\.files\(\)/);
  assert.match(memberUI, /直接记录文字，再选择、拖入或粘贴多张图片/);
  assert.match(memberRepository, /private-entry-images/);
  assert.match(memberRepository, /private_entry_images/);
});

test("public boards share the simple multi-image composer", () => {
  assert.match(communityUI, /button\("简易发布"/);
  assert.match(communityUI, /button\("专业分析"/);
  assert.match(communityUI, /imagePicker\.bindPasteTarget\(form\)/);
  assert.match(communityUI, /files: newFiles/);
  assert.match(communityUI, /route\.board/);
});

test("private entry images use a private owner-scoped bucket", () => {
  assert.match(migration, /'private-entry-images',[\s\S]*false,/);
  assert.match(migration, /private_entry_images_select_own/);
  assert.match(migration, /owner_id = auth\.uid\(\)/);
  assert.match(migration, /storage\.foldername\(name\)/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\.private_entries/i);
});

test("private record save uploads every selected image after the entry exists", async () => {
  const uploaded = [];
  const inserted = [];
  let imageNumber = 0;
  const repository = createMemberRepository(null, {
    makeId: () => `00000000-0000-4000-8000-${String(++imageNumber).padStart(12, "0")}`,
    saveEntry: async row => ({...row, id: "11111111-1111-4111-8111-111111111111"}),
    uploadPrivateEntryImage: async (path, file) => uploaded.push({path, file}),
    insertPrivateEntryImages: async rows => inserted.push(...rows),
    removePrivateEntryFiles: async () => {},
    deletePrivateEntryImageRows: async () => {}
  });
  const files = [
    {name: "一.png", type: "image/png", size: 100},
    {name: "二.jpg", type: "image/jpeg", size: 200}
  ];
  const saved = await repository.savePrivateEntry({
    ownerId: "22222222-2222-4222-8222-222222222222",
    kind: "review",
    title: "图表复盘",
    body: "请看两张图",
    review_data: {editor_mode: "simple"},
    files
  });
  assert.equal(saved.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(uploaded.length, 2);
  assert.equal(inserted.length, 2);
  assert.match(uploaded[0].path, /22222222-2222-4222-8222-222222222222\/11111111-1111-4111-8111-111111111111\//);
});
