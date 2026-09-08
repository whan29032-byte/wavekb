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
  "client_request_id",
  "task_type",
  "step",
  "analysis_schema_version",
]);

function invalidRequest(message = "invalid ai run request"): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(input: Record<string, unknown>, allowed: Set<string>): void {
  const keys = Object.keys(input);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) invalidRequest();
}

function normalizeScope(value: unknown, catalog: BookCatalog): KnowledgeScope {
  if (!isRecord(value)) invalidRequest("knowledge_scope is invalid");
  if (value.mode === "all") {
    if (Object.keys(value).length !== 1) invalidRequest("knowledge_scope is ambiguous");
    return { mode: "all" };
  }
  if (value.mode === "single") {
    if (Object.keys(value).length !== 2 || typeof value.book_id !== "string") {
      invalidRequest("knowledge_scope is ambiguous");
    }
    const match = catalog.find((book) => book.bookId === value.book_id);
    if (!match) invalidRequest("knowledge_scope book is unpublished");
    return { mode: "single", book_id: match.bookId };
  }
  invalidRequest("knowledge_scope mode is invalid");
}

export function normalizeAiRunRequest(
  input: Record<string, unknown>,
  catalog: BookCatalog,
): NormalizedAiRunRequest {
  if (!isRecord(input)) invalidRequest();
  const legacy = !Object.hasOwn(input, "request_version");
  exactKeys(input, legacy ? LEGACY_KEYS : VERSIONED_KEYS);
  if (!legacy && input.request_version !== 2) invalidRequest("request_version is invalid");
  if (typeof input.client_request_id !== "string"
    || input.client_request_id.length > 64
    || !UUID_PATTERN.test(input.client_request_id)) {
    invalidRequest("client_request_id is invalid");
  }
  if (input.task_type !== "wave_analysis") invalidRequest("task_type is invalid");
  if (!Number.isInteger(input.step) || Number(input.step) < 0 || Number(input.step) > 10) {
    invalidRequest("step is invalid");
  }
  if (input.analysis_schema_version !== "workbench-v1") {
    invalidRequest("analysis_schema_version is invalid");
  }
  return {
    request_version: 2,
    client_request_id: input.client_request_id.toLowerCase(),
    task_type: "wave_analysis",
    step: Number(input.step),
    analysis_schema_version: "workbench-v1",
    knowledge_scope: legacy
      ? { mode: "all" }
      : normalizeScope(input.knowledge_scope, catalog),
  };
}
