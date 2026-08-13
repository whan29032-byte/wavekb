import assert from "node:assert/strict";
import test from "node:test";
import {
  discordInviteCode,
  normalizeDirectoryResource,
  xHandleFromUrl,
} from "../src/directory/external-directory.ts";

test("X directory links normalize to a canonical profile and avatar", async () => {
  assert.equal(xHandleFromUrl("https://twitter.com/ElliottForecast/"), "ElliottForecast");
  const item = await normalizeDirectoryResource({
    platform: "x",
    url: "https://twitter.com/ElliottForecast/status/123",
    description: "多市场波浪分析",
    sort_order: 20,
  });
  assert.equal(item.url, "https://x.com/ElliottForecast");
  assert.equal(item.name, "@ElliottForecast");
  assert.equal(item.avatar_url, "https://unavatar.io/x/ElliottForecast");
});

test("Discord invite links resolve the guild name and community avatar", async () => {
  assert.equal(discordInviteCode("https://discord.gg/WaveRoom"), "WaveRoom");
  const fetchMock = async (url: string | URL | Request) => {
    assert.match(String(url), /discord\.com\/api\/v10\/invites\/WaveRoom/);
    return new Response(JSON.stringify({
      guild: {
        id: "123456789",
        name: "Wave Room",
        description: "结构与复盘",
        icon: "abcdef",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const item = await normalizeDirectoryResource({
    platform: "discord",
    url: "https://discord.gg/WaveRoom",
  }, fetchMock as typeof fetch);
  assert.equal(item.name, "Wave Room");
  assert.equal(item.description, "结构与复盘");
  assert.equal(
    item.avatar_url,
    "https://cdn.discordapp.com/icons/123456789/abcdef.png?size=256",
  );
});

test("directory rejects unrelated and insecure links", async () => {
  await assert.rejects(
    normalizeDirectoryResource({
      platform: "x",
      url: "https://example.com/not-x",
    }),
    /invalid_resource_url/,
  );
  await assert.rejects(
    normalizeDirectoryResource({
      platform: "discord",
      url: "http://discord.gg/WaveRoom",
    }),
    /invalid_resource_url/,
  );
});

