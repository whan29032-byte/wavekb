// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { TlineClient } from "./client";

afterEach(() => vi.unstubAllEnvs());
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function setup(responses: Response[]) {
  vi.stubEnv("TLINE_API_KEY", "test-secret-not-real");
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
  const sleep = vi.fn(async () => {});
  return { client: new TlineClient({ fetcher, sleep }), fetcher, sleep };
}

it("reads institutions using the environment key at the fixed HTTPS origin without following redirects", async () => {
  const { client, fetcher } = setup([json({ data: [{ slug: "test", name: "Test Research" }] })]);
  expect(await client.institutions()).toEqual([{ slug: "test", name: "Test Research" }]);
  expect(fetcher.mock.calls[0]).toEqual([new URL("https://tlines.tech/api/v1/institutions"), expect.objectContaining({ headers: { Authorization: "Bearer test-secret-not-real", Accept: "application/json" }, redirect: "error" })]);
});

it("requires a key before issuing a request", () => {
  vi.stubEnv("TLINE_API_KEY", "");
  expect(() => new TlineClient()).toThrow(/TLINE_API_KEY/);
});

it("keeps since and limit fixed across cursor pages, including empty intermediate pages", async () => {
  const { client, fetcher } = setup([json({ data: [{ id: "a" }], nextCursor: "a +/&" }), json({ data: [], nextCursor: "b" }), json({ data: [{ id: "c" }], nextCursor: null })]);
  const items = [];
  for await (const item of client.researchSince("2026-08-29T00:00:00.000Z")) items.push(item);
  expect(items).toEqual([{ id: "a" }, { id: "c" }]);
  const queries = fetcher.mock.calls.map((call) => Object.fromEntries(new URL(String(call[0])).searchParams));
  expect(queries).toEqual([{ since: "2026-08-29T00:00:00.000Z", limit: "200" }, { since: "2026-08-29T00:00:00.000Z", limit: "200", cursor: "a +/&" }, { since: "2026-08-29T00:00:00.000Z", limit: "200", cursor: "b" }]);
});

it("rejects a repeating cursor instead of looping forever", async () => {
  const { client } = setup([json({ data: [], nextCursor: "a" }), json({ data: [], nextCursor: "a" })]);
  await expect((async () => { for await (const item of client.researchSince("2026-08-29T00:00:00Z")) void item; })()).rejects.toThrow(/cursor/i);
});

it.each([401, 403])("fails %s immediately and preserves the API error without retrying", async (status) => {
  const { client, fetcher, sleep } = setup([json({ error: { code: "denied", message: "Access denied" } }, status)]);
  await expect(client.institutions()).rejects.toMatchObject({ status, code: "denied", message: "Access denied" });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
});

it("honors Retry-After seconds on 429 before retrying the same page", async () => {
  const { client, sleep, fetcher } = setup([json({ error: { code: "rate_limit", message: "Wait" } }, 429, { "Retry-After": "2" }), json({ data: [] })]);
  expect(await client.institutions()).toEqual([]);
  expect(sleep).toHaveBeenCalledWith(2000); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("honors the provider's normal sixty-second retry interval", async () => {
  const { client, sleep } = setup([json({}, 429, { "Retry-After": "60" }), json({ data: [] })]);
  expect(await client.institutions()).toEqual([]);
  expect(sleep).toHaveBeenCalledWith(60_000);
});

it("honors HTTP-date Retry-After", async () => {
  vi.stubEnv("TLINE_API_KEY", "test-key");
  const sleep = vi.fn(async () => {});
  const fetcher = vi.fn().mockResolvedValueOnce(json({}, 429, { "Retry-After": "Sat, 05 Sep 2026 12:00:03 GMT" })).mockResolvedValueOnce(json({ data: [] }));
  await new TlineClient({ fetcher, sleep, now: () => Date.parse("2026-09-05T12:00:00Z") }).institutions();
  expect(sleep).toHaveBeenCalledWith(3000);
});

it("bounds retries and does not sleep less than a long Retry-After", async () => {
  const { client, sleep, fetcher } = setup([json({}, 429, { "Retry-After": "3600" })]);
  await expect(client.institutions()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 3600 });
  expect(sleep).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  const retry = setup(Array.from({ length: 4 }, () => json({}, 429)));
  await expect(retry.client.institutions()).rejects.toMatchObject({ status: 429 });
  expect(retry.fetcher).toHaveBeenCalledTimes(4); expect(retry.sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
});

it("redacts reflected credentials and rejects malformed envelopes instead of reporting empty success", async () => {
  const denied = setup([json({ error: { code: "test-secret-not-real", message: "Bearer test-secret-not-real invalid" } }, 401)]);
  try { await denied.client.institutions(); } catch (error) { expect(JSON.stringify(error)).not.toContain("test-secret-not-real"); expect(String(error)).not.toContain("test-secret-not-real"); }
  const malformed = setup([json({ data: "not-an-array" })]);
  await expect(malformed.client.institutions()).rejects.toMatchObject({ code: "invalid_response" });
});

it("encodes detail IDs and ticker queries; rejects invalid since before network access", async () => {
  const { client, fetcher } = setup([json({ data: { id: "a/b" } }), json({ data: [] })]);
  expect(await client.research("a/b")).toEqual({ id: "a/b" });
  await client.consensus("SPX");
  expect(String(fetcher.mock.calls[0][0])).toBe("https://tlines.tech/api/v1/research/a%2Fb");
  expect(String(fetcher.mock.calls[1][0])).toBe("https://tlines.tech/api/v1/consensus?ticker=SPX");
  await expect(client.researchPage("not-a-date")).rejects.toThrow(/since/i);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
