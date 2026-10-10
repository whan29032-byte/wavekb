import type { SupabaseRest } from "../storage/supabase-rest.ts";
import { loadPrivateTheorySnapshot, type ResearchPrivateRepositoryPort } from "./private-theory.ts";
import { assertPublishedAnalysisOutput } from "./publication.ts";

type Retrieval = Parameters<ResearchPrivateRepositoryPort["recordRetrieval"]>[0];
type Candidate = { jobId: string; output: unknown; knowledgeVersion: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const CHUNK = /^h_[a-f0-9]{32}$/u;
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"));
}
function fail(): never { throw new Error("private_research_repository_unavailable"); }

/** Uses an injected service-side client only; contains no credential or user RPC. */
export class ResearchPrivateRepository implements ResearchPrivateRepositoryPort {
  private readonly database: Pick<SupabaseRest, "request">;
  constructor(database: Pick<SupabaseRest, "request">) { this.database = database; }

  async loadActiveArtifact(): Promise<{ artifact: unknown; expectedSha256: string } | null> {
    try {
      const result: unknown = await this.database.request("/rest/v1/rpc/hermes_research_load_active_artifact", { method: "POST", body: {} });
      if (result === null) return null;
      if (!exact(result, ["artifact", "expected_sha256"]) || typeof result.expected_sha256 !== "string" || !HEX.test(result.expected_sha256)) fail();
      // Fail closed before a caller can accidentally consume unvalidated private
      // metadata. The runtime projects this again into text-only model chunks.
      loadPrivateTheorySnapshot(result.artifact, result.expected_sha256);
      return { artifact: result.artifact, expectedSha256: result.expected_sha256 };
    } catch { return fail(); }
  }

  async recordRetrieval(input: Retrieval): Promise<void> {
    try {
      if (!exact(input, ["jobId", "artifactSha256", "chunkIds", "contextHash"])
        || typeof input.jobId !== "string" || !UUID.test(input.jobId)
        || typeof input.artifactSha256 !== "string" || !HEX.test(input.artifactSha256)
        || typeof input.contextHash !== "string" || !HEX.test(input.contextHash)
        || !Array.isArray(input.chunkIds) || input.chunkIds.length > 8
        || input.chunkIds.some((id) => typeof id !== "string" || !CHUNK.test(id))
        || new Set(input.chunkIds).size !== input.chunkIds.length) fail();
      const receipt: unknown = await this.database.request("/rest/v1/rpc/hermes_research_record_retrieval", {
        method: "POST", body: { p_job_id: input.jobId, p_artifact_sha256: input.artifactSha256,
          p_chunk_ids: [...input.chunkIds], p_context_hash: input.contextHash },
      });
      if (typeof receipt !== "string" || !UUID.test(receipt)) fail();
    } catch { fail(); }
  }

  /** Succeeded-job compensation only. The SQL success trigger is the normal path. */
  async recordCandidate(input: Candidate): Promise<void> {
    try {
      if (!exact(input, ["jobId", "output", "knowledgeVersion"]) || typeof input.jobId !== "string" || !UUID.test(input.jobId)
        || typeof input.knowledgeVersion !== "string" || !HEX.test(input.knowledgeVersion)) fail();
      assertPublishedAnalysisOutput(input.output);
      if (input.output.status !== undefined) fail();
      const receipt: unknown = await this.database.request("/rest/v1/rpc/hermes_research_record_candidate", {
        method: "POST", body: { p_job_id: input.jobId, p_output: input.output, p_knowledge_version: input.knowledgeVersion },
      });
      if (receipt !== input.jobId) fail();
    } catch { fail(); }
  }
}
