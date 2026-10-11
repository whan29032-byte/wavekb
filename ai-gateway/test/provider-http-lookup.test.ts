import assert from "node:assert/strict";
import { createServer, request, type RequestOptions, type Server } from "node:http";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import test from "node:test";
import { createPinnedProviderLookup, postJson } from "../src/providers/http.ts";

function lookupResult(lookup: LookupFunction, options: LookupOptions) {
  let called = 0;
  let result: { error: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family: number | undefined } | undefined;
  lookup("unresolved-controlled-fixture.invalid", options, (error, address, family) => {
    called += 1;
    result = { error, address, family };
  });
  assert.equal(called, 1);
  assert.ok(result);
  return result;
}

test("pinned lookup returns exactly one IPv4 or IPv6 address for the modern all contract", () => {
  for (const [address, family] of [["203.0.113.17", 4], ["2001:db8::17", 6]] as const) {
    const lookup = createPinnedProviderLookup(address);
    assert.deepEqual(lookupResult(lookup, { all: true }), {
      error: null, address: [{ address, family }], family: undefined,
    });
    // A caller cannot mutate a returned array to change a later connection.
    const first = lookupResult(lookup, { all: true });
    assert.ok(Array.isArray(first.address));
    first.address[0]!.address = "127.0.0.1";
    first.address.push({ address: "127.0.0.1", family: 4 });
    assert.deepEqual(lookupResult(lookup, { all: true }).address, [{ address, family }]);
  }
});

test("pinned lookup preserves legacy string and family with all false or absent", () => {
  for (const [address, family] of [["203.0.113.17", 4], ["2001:db8::17", 6]] as const) {
    const lookup = createPinnedProviderLookup(address);
    for (const options of [{ all: false }, {}]) {
      assert.deepEqual(lookupResult(lookup, options), { error: null, address, family });
    }
  }
});

test("pinned lookup rejects invalid address forms without reflecting input", () => {
  for (const address of ["", "provider.invalid", "http://127.0.0.1", "127.0.0.1/24", "[::1]", "127.000.000.001", "private-sentinel"]) {
    assert.throws(() => createPinnedProviderLookup(address), (error: unknown) => (
      error instanceof Error && error.message === "invalid pinned provider address"
      && (error as Error & { code?: string }).code === "REQUEST"
      && !error.message.includes(address || "private-sentinel")
    ));
  }
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("modern Node HTTP transport connects to the single pin with automatic family selection", async () => {
  let received = 0;
  const server = createServer((incoming, response) => {
    received += 1;
    assert.ok(incoming.headers.host?.startsWith("unresolved-controlled-fixture.invalid:"));
    response.setHeader("content-type", "application/json");
    response.end('{"controlled":true}');
  });
  const port = await listen(server);
  try {
    for (const autoSelectFamily of [true, false]) {
      const observedAll: boolean[] = [];
      const pinnedLookup = createPinnedProviderLookup("127.0.0.1");
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        // HTTP forwards this supported net option, but Node's HTTP type omits
        // it. Keep the known option explicit without weakening lookup typing.
        const requestOptions: RequestOptions & { autoSelectFamily: boolean } = {
          hostname: "unresolved-controlled-fixture.invalid", port, method: "GET",
          autoSelectFamily, agent: false,
          lookup: (hostname, options, callback) => {
            observedAll.push(options.all === true);
            pinnedLookup(hostname, options, callback);
          },
        };
        const outgoing = request(requestOptions, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { body += chunk; });
          response.once("error", reject);
          response.once("end", () => resolve({ status: response.statusCode ?? 0, body }));
        });
        outgoing.once("error", reject);
        outgoing.setTimeout(1_000, () => outgoing.destroy(new Error("controlled test timed out")));
        outgoing.end();
      });
      assert.deepEqual(observedAll, [autoSelectFamily]);
      assert.deepEqual(result, { status: 200, body: '{"controlled":true}' });
    }
    assert.equal(received, 2);
  } finally { await close(server); }
});

test("provider transport keeps its private-host rejection before sending anything", async () => {
  let received = 0;
  const server = createServer((_incoming, response) => { received += 1; response.end("{}"); });
  const port = await listen(server);
  try {
    await assert.rejects(() => postJson(new URL(`http://127.0.0.1:${port}`), {}, {}, 1_000), /private provider hosts are blocked/);
    assert.equal(received, 0);
  } finally { await close(server); }
});

test("provider transport retains redirect refusal, bounded timeout and safe HTTP status errors", async () => {
  const server = createServer((incoming, response) => {
    if (incoming.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("location", "http://private-sentinel.invalid/");
      response.end();
    } else if (incoming.url === "/timeout") {
      // Intentionally no response. Client timeout must close the connection.
    } else {
      response.statusCode = 422;
      response.end('{"error":"private-sentinel-upstream-body"}');
    }
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const allow = [new URL(base).host];
  try {
    await assert.rejects(() => postJson(new URL(`${base}/redirect`), {}, {}, 1_000, allow), (error: unknown) => (
      error instanceof Error && error.message === "provider redirects are not allowed"
      && (error as Error & { status?: number }).status === 302
    ));
    await assert.rejects(() => postJson(new URL(`${base}/timeout`), {}, {}, 25, allow), (error: unknown) => (
      error instanceof Error && (error as Error & { code?: string }).code === "TIMEOUT"
    ));
    await assert.rejects(() => postJson(new URL(`${base}/status`), {}, {}, 1_000, allow), (error: unknown) => (
      error instanceof Error && error.message === "provider request failed: 422"
      && (error as Error & { status?: number }).status === 422
      && !error.message.includes("private-sentinel")
    ));
  } finally { await close(server); }
});
