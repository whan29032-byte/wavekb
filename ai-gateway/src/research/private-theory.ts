import { createHash } from "node:crypto";

export interface ResearchPrivateRepositoryPort {
  loadActiveArtifact(): Promise<{ artifact: unknown; expectedSha256: string } | null>;
  recordRetrieval(input: { jobId: string; artifactSha256: string; chunkIds: string[]; contextHash: string }): Promise<void>;
}
export type PrivateTheoryChunk = { id: string; text: string; authority: "supplement" };
export type PrivateTheorySnapshot = { artifactSha256: string; privateSourceTerms: string[]; chunks: PrivateTheoryChunk[] };
const SOURCES = ["source-pages-001-070", "source-pages-071-140", "source-pages-141-210", "source-pages-211-280", "updated-rules-and-examples", "practical-courses-01-17-distilled", "chanlun-trading-system", "cross-market-sync", "wave-chanlun-integration"];
const LABELS = ["book-distillation-001", "book-distillation-002", "book-distillation-003", "book-distillation-004", "rule-supplement", "course-distillation", "structure-context", "market-context", "integration-context"];
const HEX = /^[a-f0-9]{64}$/u;
const VERSION = "hermes-theory-curation-v1";
const SUPPLEMENT_NOTICE = "本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。";
function fail(): never { throw new Error("private_theory_unavailable"); }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!record(value) || Reflect.ownKeys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))
    || Reflect.ownKeys(value).some((field) => typeof field !== "string" || !fields.includes(field)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, field) ?? {}, "value"))) fail();
  return value;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export function privateTheoryDigest(value: unknown): string { return hash(JSON.stringify(stable(value))); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function digest(value: unknown): string { if (typeof value !== "string" || !HEX.test(value)) fail(); return value; }
function positive(value: unknown, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) fail(); return value; }
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]|(?:https?|javascript|data):|(?:file|vscode|socks5h?|ssh):\/\/|\/(?:Users|home|root|private|var|tmp|etc|opt|srv|Library|Volumes)(?:\/|\b)|[a-z]:[\\/]|\\\\[a-z0-9_.-]+[\\/]|(?:^|[\s`"'(])~[\\/]|\.\.(?:\/|\\)|\.(?:md|pdf|png|jpe?g|webp|jsonl?|ya?ml|toml|ini|db|sqlite3?|txt|csv|py|mjs|tsx?|jsx?)\b|(?:^|[\s`"'(])(?:references|assets|scripts|memories|private-backup|runtime-export)[\\/]|(?:MEMORY|USER)\.md|(?:\.env|auth\.json|credentials)(?:\b|\.)|微信聊天|聊天记录|聊天原文|chat_history|conversation_history|(?:message|sender|receiver|recipient)_id\s*[=:]|^\s*(?:User|Assistant|System|Human|用户|助手|微信用户|微信联系人)\s*[:：]|<\/?(?:system|developer|assistant|tool)>|\[\/?INST\]|<\|(?:im_start|im_end|system|assistant|developer)\|>|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk_(?:live|test)_[a-z0-9]+|sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sb_secret_[a-z0-9_-]{12,})\b|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b|(?:api[_ -]?(?:key|secret)|access[_ -]?token|refresh[_ -]?token|bot[_ -]?token|context[_ -]?token|private[_ -]?key|password|passphrase|mnemonic|seed[_ -]?phrase|client[_ -]?secret|chat[_ -]?id|user[_ -]?id)\s*[=:]|authorization\s*:\s*bearer\s+|\b0x[a-f0-9]{40,64}\b|\bT[1-9A-HJ-NP-Za-km-z]{33}\b/imu;
function modelText(value: unknown, terms: readonly string[], maximumCharacters = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumCharacters * 2 || [...value].length > maximumCharacters) fail();
  const normalized = value.normalize("NFKC").toLocaleLowerCase("und")
    .replace(/%([0-9a-f]{2})/gu, (raw, hex: string) => Number.parseInt(hex, 16) <= 127 ? String.fromCharCode(Number.parseInt(hex, 16)) : raw)
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gu, (raw, hex: string | undefined, decimal: string | undefined) => {
      const code = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10); return code <= 127 ? String.fromCharCode(code) : raw;
    });
  for (const text of [value, normalized]) {
    if (UNSAFE.test(text) || (text.includes("@") && /\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}\b/iu.test(text))
      || terms.some((term) => text.toLocaleLowerCase("und").includes(term.normalize("NFKC").toLocaleLowerCase("und")))) fail();
  }
  return value;
}

/** Strict service-only loader. It returns no source titles, paths, versions or receipts. */
export function loadPrivateTheorySnapshot(value: unknown, expectedSha256: string): PrivateTheorySnapshot {
  try {
    const artifact = exact(value, ["schemaVersion", "classification", "authority", "curationVersion", "privateSourceTerms", "sources", "chunks", "artifactSha256"]);
    if (artifact.schemaVersion !== "hermes-private-theory-v2" || artifact.classification !== "server-private" || artifact.authority !== "supplement"
      || artifact.curationVersion !== VERSION || digest(artifact.artifactSha256) !== digest(expectedSha256)
      || Buffer.byteLength(JSON.stringify(artifact), "utf8") > 4 * 1024 * 1024) fail();
    const { artifactSha256, ...payload } = artifact;
    if (privateTheoryDigest(payload) !== artifactSha256 || !Array.isArray(artifact.sources) || artifact.sources.length !== 9
      || !Array.isArray(artifact.chunks) || artifact.chunks.length < 9 || artifact.chunks.length > 1_024
      || !Array.isArray(artifact.privateSourceTerms) || artifact.privateSourceTerms.length > 128
      || artifact.privateSourceTerms.some((term) => typeof term !== "string" || !term || term.length > 256 || /[\u0000-\u001f\u202a-\u202e]/u.test(term))
      || new Set(artifact.privateSourceTerms).size !== artifact.privateSourceTerms.length) fail();
    const terms = artifact.privateSourceTerms as string[];
    const sources = new Map<string, { curatedHash: string; curatedBytes: number }>();
    let sourceBytes = 0;
    for (const [i, raw] of artifact.sources.entries()) {
      const source = exact(raw, ["id", "relativePath", "sourceLabel", "authority", "original", "curated", "receipt"]);
      const original = exact(source.original, ["sha256", "bytes", "version"]);
      const curated = exact(source.curated, ["sha256", "bytes", "version"]);
      const originalHash = digest(original.sha256), curatedHash = digest(curated.sha256);
      if (source.relativePath !== `references/${SOURCES[i]}.md` || source.sourceLabel !== LABELS[i] || source.authority !== "supplement"
        || original.version !== `sha256:${originalHash}` || curated.version !== VERSION
        || source.id !== `s_${hash(`${source.relativePath}\0${originalHash}`).slice(0, 32)}`) fail();
      sourceBytes += positive(original.bytes, 512 * 1024);
      const curatedBytes = positive(curated.bytes, 512 * 1024 + 512);
      const receipt = exact(source.receipt, ["schemaVersion", "originalSha256", "curatedSha256", "transformSha256", "counts"]);
      const counts = exact(receipt.counts, ["imagesOmitted", "referenceLinesOmitted", "referenceMentionsReplaced", "titleMentionsReplaced", "newlinesNormalized", "noticeAdded"]);
      if (Object.values(counts).some((count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 100_000)
        || counts.noticeAdded !== 1 || receipt.schemaVersion !== "hermes-theory-curation-receipt-v1"
        || receipt.originalSha256 !== originalHash || receipt.curatedSha256 !== curatedHash) fail();
      const { transformSha256, ...transform } = receipt;
      if (privateTheoryDigest(transform) !== digest(transformSha256)) fail();
      sources.set(source.id as string, { curatedHash, curatedBytes });
    }
    if (sources.size !== 9 || sourceBytes > 2 * 1024 * 1024) fail();
    const seen = new Set<string>(), next = new Map<string, number>(), textBySource = new Map<string, string>();
    const chunks: PrivateTheoryChunk[] = [];
    for (const raw of artifact.chunks) {
      const chunk = exact(raw, ["id", "sourceId", "index", "text", "sha256", "authority"]);
      if (typeof chunk.sourceId !== "string" || !sources.has(chunk.sourceId) || chunk.authority !== "supplement"
        || chunk.index !== (next.get(chunk.sourceId) ?? 0) || !Number.isSafeInteger(chunk.index)) fail();
      const text = modelText(chunk.text, terms);
      if (digest(chunk.sha256) !== hash(text) || chunk.id !== `h_${hash(`${chunk.sourceId}\0${chunk.index}\0${text}`).slice(0, 32)}` || seen.has(chunk.id as string)) fail();
      next.set(chunk.sourceId, (chunk.index as number) + 1); seen.add(chunk.id as string);
      textBySource.set(chunk.sourceId, (textBySource.get(chunk.sourceId) ?? "") + text);
      chunks.push({ id: chunk.id as string, text, authority: "supplement" });
    }
    if (textBySource.size !== 9) fail();
    for (const [id, source] of sources) {
      const text = textBySource.get(id)!;
      // Check full-source unsafe tokens spanning chunk boundaries without the per-chunk ceiling.
      modelText(text, terms, 512 * 1024 + 512);
      if (!text.startsWith(`${SUPPLEMENT_NOTICE}\n\n`) || hash(text) !== source.curatedHash || Buffer.byteLength(text, "utf8") !== source.curatedBytes) fail();
    }
    return { artifactSha256: artifactSha256 as string, privateSourceTerms: [...terms], chunks };
  } catch { throw new Error("private_theory_unavailable"); }
}

export function rankPrivateTheory(snapshot: PrivateTheorySnapshot, query: string): PrivateTheoryChunk[] {
  const normalized = `${query} 波浪 结构`.normalize("NFKC").toLocaleLowerCase("und");
  const terms = normalized.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && term.length < 128 && !/^\d+$/u.test(term));
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...match[0]]; for (let i = 0; i + 1 < chars.length; i++) terms.push(`${chars[i]}${chars[i + 1]}`);
  }
  const unique = [...new Set(terms)].slice(0, 128);
  return snapshot.chunks.map((chunk, i) => ({ chunk, i, score: unique.reduce((score, term) => score + (chunk.text.toLocaleLowerCase("und").includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 8).map((item) => item.chunk);
}
