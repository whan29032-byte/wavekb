import assert from "node:assert/strict";
import test from "node:test";
import { VisionImageReader, type VisionImageInput } from "../src/research/vision-images.ts";
import { VISION_MAX_BYTES } from "../src/research/vision-input.ts";
import { inspectVisionImage } from "../src/research/vision-image-format.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";
const ids = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgUbLgUbJgQKEAGCcCZRaxQyQAAAAASUVORK5CYII=", "base64");
const config = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-credential" };
const request = (imageIds = [ids[0]!]): VisionImageInput => ({ ownerId, analysisId, step: 2, imageIds, instrument: "BTCUSDT", timeframe: "1h" });
const metadata = (id = ids[0]!) => ({ id, owner_id: ownerId, analysis_id: analysisId, step: 2, instrument: "BTCUSDT", timeframe: "1h", storage_path: `${ownerId}/${analysisId}/${id}.png`, mime_type: "image/png", byte_size: png.length });
const safeError = (code: string) => (error: unknown) => error instanceof Error && error.message === code && (error as Error & { code?: string }).code === code;
function imageResponse(bytes: Uint8Array = png, headers: Record<string, string> = { "content-type": "image/png" }) {
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}
function pngMetadataChunk(type: string, body: Uint8Array) {
  const chunk = Buffer.alloc(body.length + 12);
  chunk.writeUInt32BE(body.length); chunk.write(type, 4); Buffer.from(body).copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
function harness(options: { rows?: unknown; fetcher?: typeof fetch; databaseError?: Error; origin?: string } = {}) {
  const databaseCalls: string[] = [], fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
  const reader = new VisionImageReader({
    config: { ...config, SUPABASE_URL: options.origin ?? config.SUPABASE_URL },
    database: { request: async (path) => { databaseCalls.push(path); if (options.databaseError) throw options.databaseError; return options.rows ?? [metadata()]; } },
    fetcher: async (url, init) => {
      fetchCalls.push({ url: String(url), ...(init ? { options: init } : {}) });
      return options.fetcher ? options.fetcher(url, init) : imageResponse();
    },
  });
  return { reader, databaseCalls, fetchCalls };
}

test("server reader scopes metadata and authenticated storage to fixed owner evidence, returning only verified bytes", async () => {
  const h = harness({ fetcher: async () => imageResponse(png, { "content-type": "image/png; charset=binary", "content-length": String(png.length) }) });
  assert.deepEqual(await h.reader.load(request()), [{ imageId: ids[0], mimeType: "image/png", dataUrl: `data:image/png;base64,${png.toString("base64")}` }]);
  assert.equal(h.databaseCalls.length, 1);
  const query = new URL(`https://project.supabase.co${h.databaseCalls[0]}`);
  assert.equal(query.pathname, "/rest/v1/wave_analysis_images");
  assert.equal(query.searchParams.get("owner_id"), `eq.${ownerId}`);
  assert.equal(query.searchParams.get("analysis_id"), `eq.${analysisId}`);
  assert.equal(query.searchParams.get("step"), "eq.2");
  assert.equal(query.searchParams.get("id"), `in.(${ids[0]})`);
  assert.equal(query.searchParams.get("limit"), "3");
  assert.equal(h.fetchCalls[0]!.url, `https://project.supabase.co/storage/v1/object/authenticated/wave-analysis-images/${metadata().storage_path}`);
  const init = h.fetchCalls[0]!.options!;
  assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
  assert.equal(new Headers(init.headers).get("apikey"), config.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`);
});
test("up to three IDs are returned in accepted request order, not metadata response order", async () => {
  const h = harness({ rows: [...ids].reverse().map((id) => metadata(id)) });
  const output = await h.reader.load(request(ids));
  assert.deepEqual(output.map((v) => v.imageId), ids);
  assert.equal(h.fetchCalls.length, 3);
});
test("empty selection does not access storage, metadata or credentials", async () => {
  const h = harness({ origin: "file:///private-path" });
  assert.deepEqual(await h.reader.load(request([])), []);
  assert.equal(h.databaseCalls.length, 0); assert.equal(h.fetchCalls.length, 0);
});
test("accepted identity and selected IDs cannot be changed while metadata IO is pending", async () => {
  const input = request();
  const row = metadata();
  const reader = new VisionImageReader({ config, database: { request: async () => {
    input.ownerId = ids[2]!; input.analysisId = ids[2]!; input.instrument = "SOLUSDT";
    input.timeframe = "4h"; input.step = 7; input.imageIds[0] = ids[2]!;
    return [row];
  } }, fetcher: async () => imageResponse() });
  assert.equal((await reader.load(input))[0]!.imageId, row.id);
});
test("outbound copy strips text/EXIF metadata while immutable original bytes and pixel codec remain unchanged", async () => {
  const privateDetails = Buffer.from("owner@example.invalid GPS-source-filename-private");
  const original = Buffer.concat([png.subarray(0, 33), ...["tEXt", "iTXt", "eXIf"].map((type) => pngMetadataChunk(type, privateDetails)), png.subarray(33)]);
  const unchanged = Buffer.from(original);
  const h = harness({ rows: [{ ...metadata(), byte_size: original.length }], fetcher: async () => imageResponse(original) });
  const output = await h.reader.load(request());
  const outbound = Buffer.from(output[0]!.dataUrl.split(",")[1]!, "base64");
  assert.equal(outbound.includes(privateDetails), false);
  assert.deepEqual(outbound, png); assert.deepEqual(original, unchanged);
  assert.deepEqual(inspectVisionImage(outbound), { mimeType: "image/png", width: 2, height: 3 });
});
test("malformed request identities, steps, contexts, image IDs and URL fields fail before any IO", async () => {
  const sparse = new Array(1);
  const getter: unknown[] = []; let accessed = false;
  Object.defineProperty(getter, "0", { get() { accessed = true; return ids[0]; } });
  const invalid = [
    { ...request(), ownerId: "../owner" }, { ...request(), analysisId: "https://private.invalid" },
    { ...request(), step: 0 }, { ...request(), step: 8 }, { ...request(), step: 2.5 },
    { ...request(), instrument: "" }, { ...request(), timeframe: "1h\nprivate" }, { ...request(), instrument: "a".repeat(81) },
    { ...request(), imageIds: [ids[0], ids[0]] }, { ...request(), imageIds: [...ids, "66666666-6666-4666-8666-666666666666"] },
    { ...request(), imageIds: ["../image.png"] }, { ...request(), imageIds: ["https://private.invalid/image.png"] },
    { ...request(), imageIds: ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"] }, { ...request(), imageIds: sparse }, { ...request(), imageIds: getter },
    { ...request(), imageUrl: "https://private.invalid" }, null,
  ];
  for (const input of invalid) {
    const h = harness();
    await assert.rejects(h.reader.load(input as VisionImageInput), safeError("invalid_image_input"));
    assert.equal(h.databaseCalls.length, 0); assert.equal(h.fetchCalls.length, 0);
  }
  assert.equal(accessed, false);
});
test("configured storage origin cannot contain insecure protocol, credentials, path, query or fragment", async () => {
  for (const origin of ["http://project.supabase.co", "https://user:secret@project.supabase.co", "https://project.supabase.co/private", "https://project.supabase.co?secret=value", "https://project.supabase.co/#private", "invalid"]) {
    const h = harness({ origin });
    await assert.rejects(h.reader.load(request()), safeError("image_unavailable"));
    assert.equal(h.databaseCalls.length, 0); assert.equal(h.fetchCalls.length, 0);
  }
});
test("metadata loss and database errors surface safe unavailable errors only", async () => {
  for (const rows of [[], {}, "private body", [metadata(), metadata()]]) {
    const h = harness({ rows });
    await assert.rejects(h.reader.load(request()), safeError("image_unavailable"));
    assert.equal(h.fetchCalls.length, 0);
  }
  const h = harness({ databaseError: new Error("secret /Users/private database response") });
  await assert.rejects(h.reader.load(request()), safeError("image_unavailable"));
});
test("metadata must exactly match IDs, owner, analysis, step, current instrument/timeframe, bounded size and canonical path", async () => {
  for (const change of [
    { owner_id: ids[1] }, { analysis_id: ids[1] }, { step: 3 }, { instrument: "SOLUSDT" }, { timeframe: "4h" },
    { id: ids[1] }, { byte_size: "101" }, { byte_size: 0 }, { byte_size: VISION_MAX_BYTES + 1 },
    { storage_path: "https://private.invalid/image.png" }, { storage_path: `${metadata().storage_path}/../private` },
    { storage_path: `${otherOwner()}/${analysisId}/${ids[0]}.png` }, { mime_type: "image/svg+xml" },
    { mime_type: "image/jpeg" }, { privateFilename: "private-source.png" },
  ]) {
    const h = harness({ rows: [{ ...metadata(), ...change }] });
    await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
    assert.equal(h.fetchCalls.length, 0);
  }
  const h = harness({ rows: [metadata(ids[0]), metadata(ids[0])] });
  await assert.rejects(h.reader.load(request([ids[0]!, ids[1]!])), safeError("invalid_image_input"));
});
function otherOwner() { return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }
test("HTTP content type and real raster bytes must match metadata; SVG, broken data and MIME spoofing are rejected", async () => {
  for (const response of [
    imageResponse(png, { "content-type": "image/jpeg" }), imageResponse(png, {}),
    imageResponse(Buffer.from("<svg>secret</svg>")), imageResponse(png.subarray(0, png.length - 1)),
    imageResponse(Buffer.concat([png.subarray(0, png.length - 1), Buffer.from([0])])),
  ]) {
    const h = harness({ fetcher: async () => response });
    await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
  }
  const h = harness({ rows: [{ ...metadata(), mime_type: "image/jpeg", storage_path: `${ownerId}/${analysisId}/${ids[0]}.jpg` }], fetcher: async () => imageResponse(png, { "content-type": "image/jpeg" }) });
  await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
});
test("bounded streamed reads reject lying content lengths and oversize bodies without trusting headers", async () => {
  for (const length of ["0", "-1", "1.5", "not-a-number", String(VISION_MAX_BYTES + 1)]) {
    const h = harness({ fetcher: async () => imageResponse(png, { "content-type": "image/png", "content-length": length }) });
    await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(VISION_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const h = harness({ rows: [{ ...metadata(), byte_size: VISION_MAX_BYTES }], fetcher: async () => new Response(stream, { headers: { "content-type": "image/png", "content-length": "1" } }) });
  await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
  assert.equal(cancelled, true);
});
test("actual streamed byte count must equal immutable metadata, not an asserted Content-Length", async () => {
  for (const byteSize of [png.length - 1, png.length + 1]) {
    const h = harness({ rows: [{ ...metadata(), byte_size: byteSize }], fetcher: async () => imageResponse(png, { "content-type": "image/png", "content-length": "1" }) });
    await assert.rejects(h.reader.load(request()), safeError("invalid_image_input"));
  }
});
test("network failures, empty/404 responses and redirects never leak diagnostics or follow external targets", async () => {
  const redirected = imageResponse(); Object.defineProperty(redirected, "redirected", { value: true });
  const foreign = imageResponse(); Object.defineProperty(foreign, "url", { value: "https://private.invalid/secret" });
  for (const fetcher of [
    async () => { throw new Error("private proxy path and credential"); },
    async () => new Response("private error body", { status: 404 }),
    async () => new Response(null), async () => redirected, async () => foreign,
  ]) {
    const h = harness({ fetcher });
    await assert.rejects(h.reader.load(request()), safeError("image_unavailable"));
    assert.equal(h.fetchCalls.length, 1);
    assert.equal(h.fetchCalls[0]!.options!.redirect, "error");
  }
});
test("ten-second deadline aborts a stalled network request without retry or unsafe diagnostics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const fetched = new Promise<void>((resolve) => { started = resolve; });
  let signal: AbortSignal | undefined;
  const h = harness({ fetcher: async (_url, init) => { signal = init?.signal ?? undefined; started(); return new Promise<Response>(() => {}); } });
  const loading = h.reader.load(request());
  await fetched;
  const rejection = assert.rejects(loading, safeError("image_unavailable"));
  t.mock.timers.tick(9999); assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1); await rejection;
  assert.equal(signal?.aborted, true); assert.equal(h.fetchCalls.length, 1);
});
test("deadline also cancels a stalled streaming body; late network completion cannot resume reading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let bodyStarted!: () => void;
  const bodyReady = new Promise<void>((resolve) => { bodyStarted = resolve; });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull() { bodyStarted(); return new Promise<void>(() => {}); }, cancel() { cancelled = true; } });
  const h = harness({ fetcher: async () => new Response(stream, { headers: { "content-type": "image/png" } }) });
  const loading = h.reader.load(request());
  await bodyReady;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const rejection = assert.rejects(loading, safeError("image_unavailable"));
  t.mock.timers.tick(10000); await rejection;
  assert.equal(cancelled, true);
});
test("a response arriving after abort is cancelled without acquiring or forwarding its body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let deliver!: (value: Response) => void;
  let started!: () => void;
  const fetched = new Promise<void>((resolve) => { started = resolve; });
  const h = harness({ fetcher: async () => { started(); return new Promise<Response>((resolve) => { deliver = resolve; }); } });
  const loading = h.reader.load(request()); await fetched;
  const rejection = assert.rejects(loading, safeError("image_unavailable"));
  t.mock.timers.tick(10000); await rejection;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  deliver(new Response(stream, { headers: { "content-type": "image/png" } }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true); assert.equal(h.fetchCalls.length, 1);
});
