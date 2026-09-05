import { expect, it } from "vitest";
import { chatPreview } from "./chat-preview";

it("summarizes recognized stickers without exposing their storage protocol", () => {
  expect(chatPreview("[[sticker:diamond]]")).toBe("💎 高质量");
  const path = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.webp";
  expect(chatPreview(`[[custom-sticker:${encodeURIComponent(path)}|${encodeURIComponent("好耶")}]]`)).toBe("[表情] 好耶");
});

it("preserves text and unknown tokens, and handles empty summaries", () => {
  expect(chatPreview("普通消息")).toBe("普通消息");
  expect(chatPreview("[[sticker:unknown]]")).toBe("[[sticker:unknown]]");
  expect(chatPreview("[[custom-sticker:https%3A%2F%2Fevil.test%2Fa.png|test]]")).toBe("[[custom-sticker:https%3A%2F%2Fevil.test%2Fa.png|test]]");
  expect(chatPreview(null)).toBe("还没有消息");
  expect(chatPreview("")).toBe("还没有消息");
});
