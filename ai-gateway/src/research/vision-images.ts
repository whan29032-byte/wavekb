import type { GatewayConfig } from "../config.ts";
import type { SupabaseRest } from "../storage/supabase-rest.ts";
import { inspectVisionImage, stripVisionMetadata } from "./vision-image-format.ts";
import { normalizeVisionImageIds, VISION_MAX_BYTES, VISION_MAX_IMAGES } from "./vision-input.ts";
export type VisionImageInput = {
    ownerId: string;
    analysisId: string;
    step: number;
    imageIds: string[];
    instrument: string;
    timeframe: string;
};
export type LoadedVisionImage = {
    imageId: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    dataUrl: string;
};
export interface VisionImageReaderPort {
    load(input: VisionImageInput): Promise<LoadedVisionImage[]>;
}
type Config = Pick<GatewayConfig, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">;
type Metadata = {
    id: string;
    owner_id: string;
    analysis_id: string;
    step: number;
    instrument: string;
    timeframe: string;
    storage_path: string;
    mime_type: LoadedVisionImage["mimeType"];
    byte_size: number;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const LIMIT = VISION_MAX_BYTES;
const fields = ["id", "owner_id", "analysis_id", "step", "instrument", "timeframe", "storage_path", "mime_type", "byte_size"];
const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
function fail(code: "invalid_image_input" | "image_unavailable"): never { throw Object.assign(new Error(code), { code }); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> { return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(value, k) ?? {}, "value")); }
function context(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value); }
/** Server-only immutable evidence reader. No arbitrary image URL is accepted. */
export class VisionImageReader implements VisionImageReaderPort {
    private readonly config: Config;
    private readonly database: Pick<SupabaseRest, "request">;
    private readonly fetcher: typeof fetch;
    constructor(options: {
        config: Config;
        database: Pick<SupabaseRest, "request">;
        fetcher?: typeof fetch;
    }) {
        this.config = options.config;
        this.database = options.database;
        this.fetcher = options.fetcher ?? fetch;
    }
    async load(input: VisionImageInput): Promise<LoadedVisionImage[]> {
        if (!exact(input, ["ownerId", "analysisId", "step", "imageIds", "instrument", "timeframe"])
            || typeof input.ownerId !== "string" || !UUID.test(input.ownerId) || typeof input.analysisId !== "string" || !UUID.test(input.analysisId)
            || !Number.isInteger(input.step) || input.step < 2 || input.step > 7 || !context(input.instrument) || !context(input.timeframe)
            || !Array.isArray(input.imageIds))
            fail("invalid_image_input");
        const imageIds = normalizeVisionImageIds(input.imageIds);
        if (imageIds.some((id, index) => id !== input.imageIds[index]))
            fail("invalid_image_input");
        // Keep accepted identities stable across asynchronous metadata/download IO.
        const accepted = { ...input, imageIds };
        if (imageIds.length === 0)
            return [];
        let origin: URL;
        try {
            origin = new URL(this.config.SUPABASE_URL);
            if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
                fail("image_unavailable");
        }
        catch {
            return fail("image_unavailable");
        }
        let rows: unknown;
        try {
            rows = await this.database.request(`/rest/v1/wave_analysis_images?select=${fields.join(",")}&owner_id=eq.${accepted.ownerId}&analysis_id=eq.${accepted.analysisId}&step=eq.${accepted.step}&id=in.(${imageIds.join(",")})&limit=${VISION_MAX_IMAGES}`);
        }
        catch {
            return fail("image_unavailable");
        }
        if (!Array.isArray(rows) || rows.length !== imageIds.length)
            fail("image_unavailable");
        const metadata = new Map<string, Metadata>();
        for (const row of rows) {
            if (!exact(row, fields) || typeof row.id !== "string" || !imageIds.includes(row.id) || metadata.has(row.id)
                || row.owner_id !== accepted.ownerId || row.analysis_id !== accepted.analysisId || row.step !== accepted.step || row.instrument !== accepted.instrument || row.timeframe !== accepted.timeframe
                || typeof row.mime_type !== "string" || !Object.hasOwn(extension, row.mime_type) || !Number.isInteger(row.byte_size) || Number(row.byte_size) < 1 || Number(row.byte_size) > LIMIT
                || row.storage_path !== `${accepted.ownerId}/${accepted.analysisId}/${row.id}.${extension[row.mime_type as keyof typeof extension]}`)
                fail("invalid_image_input");
            metadata.set(row.id, row as unknown as Metadata);
        }
        const output: LoadedVisionImage[] = [];
        let total = 0;
        for (const id of imageIds) {
            const item = metadata.get(id)!;
            const bytes = await this.download(new URL(`/storage/v1/object/authenticated/wave-analysis-images/${item.storage_path}`, origin).href, item);
            total += bytes.byteLength;
            if (total > VISION_MAX_IMAGES * LIMIT)
                fail("invalid_image_input");
            const inspected = inspectVisionImage(bytes);
            if (inspected.mimeType !== item.mime_type)
                fail("invalid_image_input");
            // Strip ancillary metadata only from outbound bytes, never the immutable
            // original object or its audited upload byte_size.
            const safeBytes = stripVisionMetadata(bytes);
            const safeImage = inspectVisionImage(safeBytes);
            if (safeImage.mimeType !== inspected.mimeType || safeImage.width !== inspected.width || safeImage.height !== inspected.height)
                fail("invalid_image_input");
            output.push({ imageId: id, mimeType: safeImage.mimeType, dataUrl: `data:${safeImage.mimeType};base64,${Buffer.from(safeBytes).toString("base64")}` });
        }
        return output;
    }
    private async download(url: string, item: Metadata): Promise<Uint8Array> {
        const controller = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => { }); reject(Object.assign(new Error("image_unavailable"), { code: "image_unavailable" })); }, 10000); });
        try {
            return await Promise.race([timeout, (async () => {
                    const response = await this.fetcher(url, { method: "GET", redirect: "error", signal: controller.signal,
                        headers: { apikey: this.config.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${this.config.SUPABASE_SERVICE_ROLE_KEY}` } });
                    if (controller.signal.aborted) {
                        void response.body?.cancel().catch(() => { });
                        fail("image_unavailable");
                    }
                    if (!response.ok || response.redirected || (response.url && response.url !== url) || !response.body)
                        fail("image_unavailable");
                    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== item.mime_type)
                        fail("invalid_image_input");
                    const length = response.headers.get("content-length");
                    if (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) > LIMIT))
                        fail("invalid_image_input");
                    reader = response.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    while (true) {
                        const { value, done } = await reader.read();
                        if (controller.signal.aborted)
                            fail("image_unavailable");
                        if (done)
                            break;
                        if (!(value instanceof Uint8Array))
                            fail("invalid_image_input");
                        size += value.byteLength;
                        if (size > LIMIT) {
                            void reader.cancel().catch(() => { });
                            fail("invalid_image_input");
                        }
                        chunks.push(value);
                    }
                    if (size !== item.byte_size)
                        fail("invalid_image_input");
                    const result = new Uint8Array(size);
                    let offset = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    return result;
                })()]);
        }
        catch (error) {
            if (error instanceof Error && (error as Error & {
                code?: string;
            }).code === "invalid_image_input")
                fail("invalid_image_input");
            return fail("image_unavailable");
        }
        finally {
            if (timer)
                clearTimeout(timer);
            controller.abort();
            if (reader) {
                void reader.cancel().catch(() => { });
                try {
                    reader.releaseLock();
                }
                catch { /* A pending read is already aborted/cancelled; never expose its diagnostic. */ }
            }
        }
    }
}
