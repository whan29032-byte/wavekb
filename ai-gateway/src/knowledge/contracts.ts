import { createHash } from "node:crypto";
import type { BookCatalog, PublishedBookId } from "./index.ts";

export type KnowledgeScope =
  | { mode: "all" }
  | { mode: "single"; book_id: PublishedBookId };

export type NormalizedAiRunRequest = {
  request_version: 2;
  client_request_id: string;
  task_type: "wave_analysis";
  step: number;
  analysis_schema_version: "workbench-v1";
  knowledge_scope: KnowledgeScope;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSIONED_KEYS = new Set([
  "request_version",
  "client_request_id",
  "task_type",
  "step",
  "analysis_schema_version",
  "knowledge_scope",
]);
const LEGACY_KEYS = new Set([
  "task_type",
  "step",
  "schema_version",
]);
const ALL_SCOPE_KEYS = new Set(["mode"]);
const SINGLE_SCOPE_KEYS = new Set(["mode", "book_id"]);

function invalidRequest(message = "invalid ai run request"): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(input: Record<string, unknown>, allowed: Set<string>): void {
  const keys = Reflect.ownKeys(input);
  if (keys.length !== allowed.size
    || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    invalidRequest();
  }
}

function normalizeScope(value: unknown, catalog: BookCatalog): KnowledgeScope {
  if (!isRecord(value)) invalidRequest("knowledge_scope is invalid");
  if (value.mode === "all") {
    exactKeys(value, ALL_SCOPE_KEYS);
    return { mode: "all" };
  }
  if (value.mode === "single") {
    exactKeys(value, SINGLE_SCOPE_KEYS);
    if (typeof value.book_id !== "string") {
      invalidRequest("knowledge_scope is ambiguous");
    }
    const match = catalog.find((book) => book.bookId === value.book_id);
    if (!match) invalidRequest("knowledge_scope book is unpublished");
    return { mode: "single", book_id: match.bookId };
  }
  invalidRequest("knowledge_scope mode is invalid");
}

function legacyRequestId(
  context: { ownerId: string; analysisId: string } | undefined,
  input: Record<string, unknown>,
): string {
  if (!context || typeof context.ownerId !== "string" || typeof context.analysisId !== "string") {
    invalidRequest("legacy request context is required");
  }
  const bytes = createHash("sha256").update(JSON.stringify({
    owner_id: context.ownerId,
    analysis_id: context.analysisId,
    task_type: input.task_type,
    step: input.step,
    schema_version: input.schema_version,
  })).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function normalizeAiRunRequest(
  input: Record<string, unknown>,
  catalog: BookCatalog,
  legacyContext?: { ownerId: string; analysisId: string },
): NormalizedAiRunRequest {
  if (!isRecord(input)) invalidRequest();
  const legacy = !Object.hasOwn(input, "request_version");
  exactKeys(input, legacy ? LEGACY_KEYS : VERSIONED_KEYS);
  if (!legacy && input.request_version !== 2) invalidRequest("request_version is invalid");
  if (!legacy && (typeof input.client_request_id !== "string"
    || input.client_request_id.length > 64
    || !UUID_PATTERN.test(input.client_request_id))) {
    invalidRequest("client_request_id is invalid");
  }
  if (input.task_type !== "wave_analysis") invalidRequest("task_type is invalid");
  if (!Number.isInteger(input.step) || Number(input.step) < 0 || Number(input.step) > 10) {
    invalidRequest("step is invalid");
  }
  if ((legacy ? input.schema_version : input.analysis_schema_version) !== "workbench-v1") {
    invalidRequest("analysis_schema_version is invalid");
  }
  return {
    request_version: 2,
    client_request_id: legacy
      ? legacyRequestId(legacyContext, input)
      : (input.client_request_id as string).toLowerCase(),
    task_type: "wave_analysis",
    step: Number(input.step),
    analysis_schema_version: "workbench-v1",
    knowledge_scope: legacy
      ? { mode: "all" }
      : normalizeScope(input.knowledge_scope, catalog),
  };
}
