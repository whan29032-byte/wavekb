// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  configured: true,
  owner: "11111111-1111-4111-8111-111111111111",
  token: "private-user-token",
}));

vi.mock("@/lib/env", () => ({
  publicSupabaseConfig: () => ({ configured: boundary.configured }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: boundary.owner ? { id: boundary.owner } : null },
        error: null,
      }),
      getSession: async () => ({
        data: { session: boundary.token ? { access_token: boundary.token } : null },
        error: null,
      }),
    },
  }),
}));

import { GET, PUT } from "./route";

const fetchMock = vi.fn();
const cycleId = "22222222-2222-4222-8222-222222222222";
const context = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const upstream = (body: object, status = 200, headers?: HeadersInit) => new Response(
  JSON.stringify(body),
  { status, headers: { "content-type": "application/json", ...headers } },
);

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://wavekb.com/api/trading/${path}`, init);
}

function write(path: string, body: object, origin = "https://wavekb.com") {
  return request(path, {
    method: "PUT",
    headers: {
      origin,
      "sec-fetch-site": origin === "https://wavekb.com" ? "same-origin" : "cross-site",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AUTH_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8787");
  vi.stubEnv("AUTH_GATEWAY_PUBLIC_ORIGIN", "https://wavekb.com");
  fetchMock.mockReset();
  boundary.configured = true;
  boundary.owner = "11111111-1111-4111-8111-111111111111";
  boundary.token = "private-user-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("private trade chart proxy", () => {
  it("forwards the exact chart read with query and only the bearer credential", async () => {
    fetchMock.mockResolvedValue(upstream({ chart: { cycle_id: cycleId } }));
    const query = "timeframe=1h&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z";
    const response = await GET(
      request(`trades/${cycleId}/chart?${query}`, {
        headers: { cookie: "session=do-not-forward", "x-private": "do-not-forward" },
      }),
      context("trades", cycleId, "chart"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chart: { cycle_id: cycleId } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:8787/v1/user/trading-trades/${cycleId}/chart?${query}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(new Headers(init.headers)).toEqual(new Headers({ authorization: "Bearer private-user-token" }));
  });

  it.each([
    ["chart state", ["trades", cycleId, "chart-state"], { expected_cycle_revision: 7, state: { version: 1 } }, `/v1/user/trading-trades/${cycleId}/chart-state`],
    ["fill annotation", ["trades", cycleId, "fills", "42", "annotation"], { expected_cycle_revision: 7, note: "memo", images: [] }, `/v1/user/trading-trades/${cycleId}/fills/42/annotation`],
  ])("forwards the exact %s write", async (_label, path, body, target) => {
    fetchMock.mockResolvedValue(upstream({ saved: true }));
    const response = await PUT(write(path.join("/"), body), context(...path));

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:8787${target}`);
    expect(new Headers(init.headers)).toEqual(new Headers({
      authorization: "Bearer private-user-token",
      "content-type": "application/json",
    }));
    expect(init.body).toBe(JSON.stringify(body));
  });

  it.each([
    [["trades", "not-a-uuid", "chart"]],
    [["trades", cycleId, "fills", "not-numeric", "annotation"]],
    [["trades", cycleId, "chart", "extra"]],
    [["trades", cycleId, "%2Fchart"]],
  ])("rejects unsupported chart path %j before authentication or forwarding", async (path) => {
    const response = await GET(request(path.join("/")), context(...path));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes and oversized payloads before forwarding", async () => {
    const crossOrigin = await PUT(
      write(`trades/${cycleId}/chart-state`, { expected_cycle_revision: 7 }, "https://attacker.example"),
      context("trades", cycleId, "chart-state"),
    );
    expect(crossOrigin.status).toBe(403);

    const oversized = await PUT(
      write(`trades/${cycleId}/chart-state`, { state: "x".repeat(33 * 1024) }),
      context("trades", cycleId, "chart-state"),
    );
    expect(oversized.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a no-store safe failure when the private gateway is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("private host and token must not escape"));
    const response = await GET(
      request(`trades/${cycleId}/chart?timeframe=1h&from=a&to=b`),
      context("trades", cycleId, "chart"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "trading_gateway_unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
