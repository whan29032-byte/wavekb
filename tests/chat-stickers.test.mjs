import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
const memberUI = require(fileURLToPath(new URL("../community/member-ui.js", import.meta.url)));
const memberRepository = require(fileURLToPath(new URL("../community/member-repository.js", import.meta.url)));

test("custom sticker validation accepts static and animated safe formats", () => {
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
    assert.equal(memberUI.validateCustomStickerFile({type, size: 1024}).ok, true);
  }
  assert.equal(memberUI.validateCustomStickerFile({type: "image/svg+xml", size: 1024}).ok, false);
  assert.equal(memberUI.validateCustomStickerFile({type: "image/gif", size: 12 * 1024 * 1024 + 1}).ok, false);
  assert.equal(memberUI.validateCustomStickerFile({type: "", name: "手机表情.WEBP", size: 1024}).ok, true);
});

test("messenger allows selecting more than one custom sticker at a time", async () => {
  const member = await read("community/member-ui.js");
  assert.match(member, /stickerFileInput\.multiple = true/);
  assert.match(member, /Array\.from\(stickerFileInput\.files \|\| \[\]\)/);
  assert.match(member, /for \(const file of files\)/);
});

test("repository infers a missing mobile MIME type from the file name", async () => {
  const calls = [];
  const gateway = {
    makeId: () => "eff18eb6-7b50-494c-a4a0-26198c72abe7",
    uploadChatSticker: async (path, file) => calls.push([path, file.name]),
    createChatSticker: async row => row
  };
  const repository = memberRepository.createMemberRepository({}, gateway);
  const result = await repository.uploadChatSticker(
    "91d6936d-af51-4f99-8016-6f0f0e8a2d41",
    {type: "", name: "波浪动图.WEBP"}
  );
  assert.match(result.storage_path, /\.webp$/);
  assert.equal(result.mime_type, "image/webp");
  assert.equal(result.label, "波浪动图");
});

test("custom sticker message tokens accept only generated storage paths", () => {
  const sticker = {
    storage_path: "91d6936d-af51-4f99-8016-6f0f0e8a2d41/eff18eb6-7b50-494c-a4a0-26198c72abe7.gif",
    label: "动态波浪"
  };
  const token = memberUI.customStickerToken(sticker);
  assert.deepEqual(memberUI.customStickerFromBody(token), sticker);
  assert.equal(memberUI.customStickerFromBody("[[custom-sticker:https%3A%2F%2Fevil.example%2Fa.gif|x]]"), null);
});

test("repository stores custom stickers in their own bucket and table", async () => {
  const repository = await read("community/member-repository.js");
  assert.match(repository, /from\("chat-stickers"\)\.upload/);
  assert.match(repository, /from\("chat_stickers"\)/);
  assert.match(repository, /listChatStickers/);
  assert.match(repository, /deleteChatSticker/);
  assert.match(repository, /cacheControl: "31536000"/);
});

test("repository generates an owner-scoped immutable sticker path", async () => {
  const calls = [];
  const gateway = {
    makeId: () => "eff18eb6-7b50-494c-a4a0-26198c72abe7",
    uploadChatSticker: async (path, file) => calls.push(["upload", path, file.type]),
    createChatSticker: async row => (calls.push(["create", row]), row),
    chatStickerPublicUrl: path => `https://storage.example/${path}`
  };
  const repository = memberRepository.createMemberRepository({}, gateway);
  const result = await repository.uploadChatSticker(
    "91d6936d-af51-4f99-8016-6f0f0e8a2d41",
    {type: "image/gif", name: "动态波浪.gif"}
  );
  assert.equal(result.storage_path, "91d6936d-af51-4f99-8016-6f0f0e8a2d41/eff18eb6-7b50-494c-a4a0-26198c72abe7.gif");
  assert.deepEqual(calls[0], ["upload", result.storage_path, "image/gif"]);
  assert.equal(result.label, "动态波浪");
});

test("chat sticker migration is scoped and non-destructive", async () => {
  const sql = await read("supabase/migrations/202608030007_chat_stickers.sql");
  assert.match(sql, /file_size_limit[\s\S]*12582912/);
  assert.match(sql, /image\/gif/);
  assert.match(sql, /image\/webp/);
  assert.match(sql, /storage\.foldername\(name\)/);
  assert.match(sql, /owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.profiles|delete from auth\./i);
});
