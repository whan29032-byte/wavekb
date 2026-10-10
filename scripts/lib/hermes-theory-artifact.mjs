import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HERMES_THEORY_SCHEMA_VERSION = "hermes-private-theory-v1";
export const HERMES_THEORY_CURATED_SCHEMA_VERSION = "hermes-private-theory-v2";
export const HERMES_THEORY_CURATION_VERSION = "hermes-theory-curation-v1";
export const HERMES_THEORY_SOURCE_ALLOWLIST = Object.freeze([
  "references/source-pages-001-070.md",
  "references/source-pages-071-140.md",
  "references/source-pages-141-210.md",
  "references/source-pages-211-280.md",
  "references/updated-rules-and-examples.md",
  "references/practical-courses-01-17-distilled.md",
  "references/chanlun-trading-system.md",
  "references/cross-market-sync.md",
  "references/wave-chanlun-integration.md",
]);

export const HERMES_THEORY_LIMITS = Object.freeze({
  fileBytes: 512 * 1024,
  totalSourceBytes: 2 * 1024 * 1024,
  artifactBytes: 4 * 1024 * 1024,
  chunkCharacters: 2_000,
  chunks: 1_024,
});

const SOURCE_LABELS = Object.freeze([
  "book-distillation-001", "book-distillation-002", "book-distillation-003", "book-distillation-004",
  "rule-supplement", "course-distillation", "structure-context", "market-context", "integration-context",
]);
const HEX = /^[a-f0-9]{64}$/u;
const OPAQUE_SOURCE = /^s_[a-f0-9]{32}$/u;
const OPAQUE_CHUNK = /^h_[a-f0-9]{32}$/u;
const PRIVATE_NAMES = /(?:^|[\s/\\`"'(])(?:\.env(?:\.[a-z0-9_-]+)?|MEMORY\.md|USER\.md|trading\.db|auth\.json|credentials(?:\.[a-z0-9_-]+)?|chat-image-text-complete\.md|private-backup|runtime-export)(?=$|[\s/\\`"'),;:])/iu;
const LOCAL_PATH = /(?:file|vscode|socks5h?|ssh):\/\/|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?=[:/\s]|$)|\/(?:Users|home|root|private|var|tmp|etc|opt|srv|Library|Volumes)(?:\/|\b)|[a-z]:[\\/]|\\\\[a-z0-9_.-]+[\\/]|(?:^|[\s`"'(])~[\\/]/iu;
const SECRETS = /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:sk_(?:live|test)_[a-z0-9]+|sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sb_secret_[a-z0-9_-]{12,})\b|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b|(?:api[_ -]?(?:key|secret)|access[_ -]?token|refresh[_ -]?token|bot[_ -]?token|context[_ -]?token|private[_ -]?key|passphrase|mnemonic|seed[_ -]?phrase|client[_ -]?secret|password|chat[_ -]?id|user[_ -]?id)\s*[=:]\s*\S+|(?:authorization\s*:\s*bearer\s+|https?:\/\/[^\s/@]+:[^\s/@]+@)/iu;
// Unbounded email prefixes restart at each dot/word boundary on hostile input.
// The literal @ precheck keeps non-email text linear; both address components
// are additionally bounded so adding a trailing @ cannot revive that behavior.
const EMAIL_ADDRESS = /\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}\b/iu;
const WALLET_IDENTIFIERS = /\b0x[a-f0-9]{40,64}\b|\bT[1-9A-HJ-NP-Za-km-z]{33}\b/iu;
// Match the extension rather than a greedy filename prefix. The bounded input
// can still be attacker-controlled; a long token must not cause quadratic scans.
const FILE_REFERENCE = /\.(?:md|jsonl?|ya?ml|toml|ini|db|sqlite3?|pdf|png|jpe?g|webp|csv|txt|py|mjs|tsx?|jsx?)(?=$|[^a-z0-9])/iu;
const RELATIVE_REFERENCE = /(?:^|[\s`"'(])(?:\.\.?\/|(?:references|assets|scripts|memories|private-backup|runtime-export)[\\/])/iu;
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const MODEL_ROLES = /<\/?(?:system|developer|assistant|tool)>|\[\/?INST\]|<\|(?:im_start|im_end|system|assistant|developer)\|>/iu;
const PRIVATE_RECORD = /微信聊天|聊天记录|聊天原文|\b(?:chat_history|conversation_history)\b|(?:message|sender|receiver|recipient)_id\s*[=:]|^\s*(?:User|Assistant|System|Human|用户|助手|微信用户|微信联系人)\s*[:：]/imu;
const SUPPLEMENT_NOTICE = "本段为补充理论资料；不得覆盖网站第十一版原书规则。未载入的图片不构成已验证证据。";
const EXTERNAL_URI = /(?:https?|javascript|data):/iu;

export class HermesTheoryArtifactError extends Error {
  constructor(code) {
    super(code);
    this.name = "HermesTheoryArtifactError";
    this.code = code;
  }
}

function fail(code) { throw new HermesTheoryArtifactError(code); }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(stable(value)); }
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function sourceId(relativePath, digest) { return `s_${hash(`${relativePath}\0${digest}`).slice(0, 32)}`; }
function chunkId(id, index, text) { return `h_${hash(`${id}\0${index}\0${text}`).slice(0, 32)}`; }

function directoryChain(absolutePath) {
  if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath) || path.resolve(absolutePath) !== absolutePath) fail("E_PATH_INVALID");
  let current = path.parse(absolutePath).root;
  for (const part of absolutePath.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch { fail("E_DIRECTORY_UNAVAILABLE"); }
    if (stat.isSymbolicLink()) fail("E_SYMLINK");
    if (!stat.isDirectory()) fail("E_NOT_DIRECTORY");
  }
  try { if (fs.realpathSync(absolutePath) !== absolutePath) fail("E_PATH_ESCAPE"); }
  catch (error) { if (error instanceof HermesTheoryArtifactError) throw error; fail("E_DIRECTORY_UNAVAILABLE"); }
  return fs.lstatSync(absolutePath);
}

function safeSourceRoot(sourceRoot) {
  if (typeof fs.constants.O_NOFOLLOW !== "number" || typeof process.getuid !== "function") fail("E_PLATFORM_UNSUPPORTED");
  directoryChain(sourceRoot);
  return sourceRoot;
}

function readSource(sourceRoot, relativePath, allowReferences = false) {
  if (!HERMES_THEORY_SOURCE_ALLOWLIST.includes(relativePath)) fail("E_SOURCE_NOT_ALLOWED");
  const absolutePath = path.join(sourceRoot, relativePath);
  if (!inside(sourceRoot, absolutePath)) fail("E_PATH_ESCAPE");
  directoryChain(path.dirname(absolutePath));
  let stat;
  try { stat = fs.lstatSync(absolutePath, { bigint: true }); } catch { fail("E_SOURCE_UNAVAILABLE"); }
  if (stat.isSymbolicLink()) fail("E_SYMLINK");
  if (!stat.isFile() || stat.nlink !== 1n) fail("E_SOURCE_NOT_REGULAR");
  if (stat.size <= 0n || stat.size > BigInt(HERMES_THEORY_LIMITS.fileBytes)) fail("E_SOURCE_SIZE");
  try { if (fs.realpathSync(absolutePath) !== absolutePath) fail("E_PATH_ESCAPE"); }
  catch (error) { if (error instanceof HermesTheoryArtifactError) throw error; fail("E_SOURCE_UNAVAILABLE"); }
  let descriptor;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || !opened.isFile()) fail("E_SOURCE_CHANGED");
    const buffer = Buffer.alloc(HERMES_THEORY_LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length !== Number(stat.size) || length > HERMES_THEORY_LIMITS.fileBytes) fail("E_SOURCE_CHANGED");
    const after = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(absolutePath, { bigint: true });
    directoryChain(path.dirname(absolutePath));
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs
      || after.size !== stat.size || named.dev !== stat.dev || named.ino !== stat.ino || named.isSymbolicLink()
      || fs.realpathSync(absolutePath) !== absolutePath) fail("E_SOURCE_CHANGED");
    const bytes = buffer.subarray(0, length);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("E_SOURCE_UTF8"); }
    assertModelText(text, { allowReferences });
    return { text, bytes: length, sha256: hash(bytes) };
  } catch (error) {
    if (error instanceof HermesTheoryArtifactError) throw error;
    fail("E_SOURCE_READ");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertModelText(text, { allowReferences = false, rejectExternal = false } = {}) {
  if (typeof text !== "string" || !text.trim()) fail("E_CONTENT_EMPTY");
  if (INVISIBLE.test(text)) fail("E_CONTENT_CONTROL");
  // Scan normalized ASCII escapes as well: encoded /Users paths or fullwidth
  // credentials must not survive simply because the bytes use another spelling.
  const normalized = text.normalize("NFKC").replace(/%([0-9a-f]{2})/giu, (match, hex) => {
    const value = Number.parseInt(hex, 16);
    return value <= 0x7f ? String.fromCharCode(value) : match;
  }).replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/giu, (match, hex, decimal) => {
    const value = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return value <= 0x7f ? String.fromCharCode(value) : match;
  });
  for (const candidate of new Set([text, normalized])) {
    if (INVISIBLE.test(candidate)) fail("E_CONTENT_CONTROL");
    if (PRIVATE_NAMES.test(candidate) || PRIVATE_RECORD.test(candidate)) fail("E_CONTENT_PRIVATE");
    if (LOCAL_PATH.test(candidate)) fail("E_CONTENT_LOCAL_PATH");
    if (SECRETS.test(candidate) || WALLET_IDENTIFIERS.test(candidate)
      || (candidate.includes("@") && EMAIL_ADDRESS.test(candidate))) fail("E_CONTENT_SENSITIVE");
    if (!allowReferences && (FILE_REFERENCE.test(candidate) || RELATIVE_REFERENCE.test(candidate)
      || SOURCE_LABELS.some((label) => candidate.toLowerCase().includes(label))
      || HERMES_THEORY_SOURCE_ALLOWLIST.some((relativePath) => candidate.includes(relativePath)))) fail("E_CONTENT_REFERENCE");
    if (MODEL_ROLES.test(candidate)) fail("E_CONTENT_INSTRUCTION");
    if (rejectExternal && EXTERNAL_URI.test(candidate)) fail("E_CONTENT_REFERENCE");
  }
}

/** Deterministic, conservative review copy. Originals are never rewritten. */
export function curateHermesTheoryText(original) {
  assertModelText(original, { allowReferences: true });
  const counts = { imagesOmitted: 0, referenceLinesOmitted: 0, titleMentionsReplaced: 0,
    referenceMentionsReplaced: 0, newlinesNormalized: (original.match(/\r\n/gu) ?? []).length, noticeAdded: 1 };
  const terms = new Set(HERMES_THEORY_SOURCE_ALLOWLIST.flatMap((name) => [name, path.basename(name)]));
  // Bound both spans: malformed repeated openers cannot cause quadratic scans.
  let text = original.replace(/\r\n/gu, "\n").replace(/!\[[^\]\n]{0,512}\]\([^\n)]{0,2048}\)/gu, () => {
    counts.imagesOmitted += 1;
    return "[图示未载入；仅依据文字，不推断图片细节。]";
  });
  text = text.split("\n").flatMap((line) => {
    if (/^\s*(?:>\s*)?(?:来源[：:]|核对对象[：:]|记录规则[：:]|图例状态[：:]|source[：:])/iu.test(line)
      || /^\s*#{1,6}\s+.*(?:原书逐页蒸馏|来源说明与导航|PDF(?:物理)?页导航|PDF第[\d–—-]+页)/u.test(line)
      || /^\s*(?:>\s*)?原书基础参见PDF[^。！？]*[。]?\s*$/u.test(line)) { counts.referenceLinesOmitted += 1; return []; }
    // Remove only the citation fragment, not the adjoining theory clause.
    let reviewed = line.replace(/`([^`\n]{1,1024})`/gu, (raw, inner) => {
      if (!FILE_REFERENCE.test(inner) && !RELATIVE_REFERENCE.test(inner)) return raw;
      counts.referenceMentionsReplaced += 1; return "[来源引用已隐藏]";
    }).replace(/\[([^\]\n]{0,512})\]\(([^\n)]{0,2048})\)/gu, (raw, _label, target) => {
      if (!FILE_REFERENCE.test(target) && !RELATIVE_REFERENCE.test(target) && !EXTERNAL_URI.test(target)) return raw;
      counts.referenceMentionsReplaced += 1; return "[来源引用已隐藏]";
    });
    for (const term of [...terms].sort((a, b) => b.length - a.length)) {
      if (reviewed.includes(term)) { counts.referenceMentionsReplaced += reviewed.split(term).length - 1; reviewed = reviewed.replaceAll(term, "[来源引用已隐藏]"); }
    }
    // Unknown reference spellings are rejected later rather than deleting their
    // full line; a failed export is preferable to silently losing a rule.
    return [reviewed];
  }).join("\n");
  text = text.replace(/《([^《》\n]{1,120})》/gu, (_, title) => {
    // These are also public theory concepts, not distinctive private titles.
    // Keep their quoted citation spelling private without banning the concept.
    if (!["波浪理论", "自然法则", "艾略特演说", "缠论"].includes(title)) terms.add(title);
    terms.add(`《${title}》`); counts.titleMentionsReplaced += 1;
    return "理论资料";
  });
  text = `${SUPPLEMENT_NOTICE}\n\n${text.trim()}`;
  assertModelText(text, { rejectExternal: true });
  return { text, counts, privateSourceTerms: [...terms].sort() };
}

export function buildCuratedHermesTheoryArtifact({ sourceRoot, expectedSourceHashes } = {}) {
  safeSourceRoot(sourceRoot);
  if (expectedSourceHashes !== undefined && (!exactKeys(expectedSourceHashes, HERMES_THEORY_SOURCE_ALLOWLIST)
    || Object.values(expectedSourceHashes).some((value) => !HEX.test(value)))) fail("E_EXPECTED_HASHES");
  const sources = [];
  const chunks = [];
  const privateSourceTerms = new Set();
  let total = 0;
  for (const [sourceIndex, relativePath] of HERMES_THEORY_SOURCE_ALLOWLIST.entries()) {
    const original = readSource(sourceRoot, relativePath, true);
    total += original.bytes;
    if (total > HERMES_THEORY_LIMITS.totalSourceBytes) fail("E_TOTAL_SIZE");
    if (expectedSourceHashes && expectedSourceHashes[relativePath] !== original.sha256) fail("E_SOURCE_HASH_MISMATCH");
    const curated = curateHermesTheoryText(original.text);
    const curatedHash = hash(curated.text);
    const id = sourceId(relativePath, original.sha256);
    curated.privateSourceTerms.forEach((term) => privateSourceTerms.add(term));
    const receipt = { schemaVersion: "hermes-theory-curation-receipt-v1", originalSha256: original.sha256,
      curatedSha256: curatedHash, counts: curated.counts };
    sources.push({ id, relativePath, sourceLabel: SOURCE_LABELS[sourceIndex], authority: "supplement",
      original: { sha256: original.sha256, bytes: original.bytes, version: `sha256:${original.sha256}` },
      curated: { sha256: curatedHash, bytes: Buffer.byteLength(curated.text, "utf8"), version: HERMES_THEORY_CURATION_VERSION },
      receipt: { ...receipt, transformSha256: hash(stableJson(receipt)) } });
    for (const [index, text] of splitText(curated.text).entries()) {
      chunks.push({ id: chunkId(id, index, text), sourceId: id, index, text, sha256: hash(text), authority: "supplement" });
      if (chunks.length > HERMES_THEORY_LIMITS.chunks) fail("E_CHUNK_LIMIT");
    }
  }
  const payload = { schemaVersion: HERMES_THEORY_CURATED_SCHEMA_VERSION, classification: "server-private", authority: "supplement",
    curationVersion: HERMES_THEORY_CURATION_VERSION, privateSourceTerms: [...privateSourceTerms].sort(), sources, chunks };
  const artifact = { ...payload, artifactSha256: hash(stableJson(payload)) };
  validateHermesTheoryArtifact(artifact);
  return artifact;
}

function validateCuratedArtifact(artifact) {
  if (!exactKeys(artifact, ["schemaVersion", "classification", "authority", "curationVersion", "privateSourceTerms", "sources", "chunks", "artifactSha256"])
    || artifact.classification !== "server-private" || artifact.authority !== "supplement"
    || artifact.curationVersion !== HERMES_THEORY_CURATION_VERSION || !HEX.test(artifact.artifactSha256)
    || !Array.isArray(artifact.privateSourceTerms) || artifact.privateSourceTerms.length > 128
    || artifact.privateSourceTerms.some((term) => typeof term !== "string" || !term || term.length > 256 || INVISIBLE.test(term))
    || new Set(artifact.privateSourceTerms).size !== artifact.privateSourceTerms.length
    || !Array.isArray(artifact.sources) || artifact.sources.length !== 9 || !Array.isArray(artifact.chunks)
    || artifact.chunks.length < 9 || artifact.chunks.length > HERMES_THEORY_LIMITS.chunks) fail("E_ARTIFACT_SCHEMA");
  const sourceMap = new Map();
  let bytes = 0;
  for (const [i, source] of artifact.sources.entries()) {
    if (!exactKeys(source, ["id", "relativePath", "sourceLabel", "authority", "original", "curated", "receipt"])
      || source.relativePath !== HERMES_THEORY_SOURCE_ALLOWLIST[i] || source.sourceLabel !== SOURCE_LABELS[i] || source.authority !== "supplement"
      || !exactKeys(source.original, ["sha256", "bytes", "version"]) || !HEX.test(source.original.sha256)
      || source.original.version !== `sha256:${source.original.sha256}` || !Number.isSafeInteger(source.original.bytes)
      || source.original.bytes < 1 || source.original.bytes > HERMES_THEORY_LIMITS.fileBytes
      || !exactKeys(source.curated, ["sha256", "bytes", "version"]) || !HEX.test(source.curated.sha256)
      || source.curated.version !== HERMES_THEORY_CURATION_VERSION || !Number.isSafeInteger(source.curated.bytes)
      || source.curated.bytes < 1 || source.curated.bytes > HERMES_THEORY_LIMITS.fileBytes + 512
      || source.id !== sourceId(source.relativePath, source.original.sha256)
      || !exactKeys(source.receipt, ["schemaVersion", "originalSha256", "curatedSha256", "transformSha256", "counts"])
      || source.receipt.schemaVersion !== "hermes-theory-curation-receipt-v1"
      || source.receipt.originalSha256 !== source.original.sha256 || source.receipt.curatedSha256 !== source.curated.sha256
      || !exactKeys(source.receipt.counts, ["imagesOmitted", "referenceLinesOmitted", "referenceMentionsReplaced", "titleMentionsReplaced", "newlinesNormalized", "noticeAdded"])
      || Object.values(source.receipt.counts).some((count) => !Number.isSafeInteger(count) || count < 0 || count > 100_000)
      || source.receipt.counts.noticeAdded !== 1) fail("E_ARTIFACT_SOURCE");
    const { transformSha256, ...receipt } = source.receipt;
    if (hash(stableJson(receipt)) !== transformSha256) fail("E_ARTIFACT_SOURCE");
    bytes += source.original.bytes;
    sourceMap.set(source.id, source);
  }
  if (bytes > HERMES_THEORY_LIMITS.totalSourceBytes || sourceMap.size !== 9) fail("E_ARTIFACT_SOURCE");
  const texts = new Map();
  const next = new Map();
  const ids = new Set();
  for (const chunk of artifact.chunks) {
    if (!exactKeys(chunk, ["id", "sourceId", "index", "text", "sha256", "authority"])
      || !sourceMap.has(chunk.sourceId) || chunk.authority !== "supplement" || chunk.index !== (next.get(chunk.sourceId) ?? 0)
      || !Number.isSafeInteger(chunk.index) || typeof chunk.text !== "string" || chunk.text.length > 4_000
      || [...chunk.text].length > 2_000 || hash(chunk.text) !== chunk.sha256 || chunk.id !== chunkId(chunk.sourceId, chunk.index, chunk.text)
      || ids.has(chunk.id)) fail("E_ARTIFACT_CHUNK");
    assertModelText(chunk.text, { rejectExternal: true });
    ids.add(chunk.id); next.set(chunk.sourceId, chunk.index + 1);
    texts.set(chunk.sourceId, (texts.get(chunk.sourceId) ?? "") + chunk.text);
  }
  for (const [id, source] of sourceMap) {
    const text = texts.get(id);
    if (typeof text !== "string") fail("E_ARTIFACT_COVERAGE");
    assertModelText(text, { rejectExternal: true });
    if (!text.startsWith(`${SUPPLEMENT_NOTICE}\n\n`) || EXTERNAL_URI.test(text)
      || hash(text) !== source.curated.sha256 || Buffer.byteLength(text, "utf8") !== source.curated.bytes
      || artifact.privateSourceTerms.some((term) => text.toLocaleLowerCase("und").includes(term.toLocaleLowerCase("und")))) fail("E_ARTIFACT_SOURCE");
  }
  const { artifactSha256, ...payload } = artifact;
  if (hash(stableJson(payload)) !== artifactSha256) fail("E_ARTIFACT_HASH_MISMATCH");
  if (Buffer.byteLength(JSON.stringify(artifact), "utf8") > HERMES_THEORY_LIMITS.artifactBytes) fail("E_ARTIFACT_SIZE");
  return artifact;
}

function splitText(text) {
  const result = [];
  let current = "";
  let count = 0;
  for (const character of text.replace(/\r\n/gu, "\n").trim()) {
    if (count === HERMES_THEORY_LIMITS.chunkCharacters) {
      if (current.trim()) result.push(current);
      current = "";
      count = 0;
    }
    current += character;
    count += 1;
  }
  if (current.trim()) result.push(current);
  return result;
}

export function buildHermesTheoryArtifact({ sourceRoot, expectedSourceHashes } = {}) {
  safeSourceRoot(sourceRoot);
  if (expectedSourceHashes !== undefined
    && (!exactKeys(expectedSourceHashes, HERMES_THEORY_SOURCE_ALLOWLIST) || Object.values(expectedSourceHashes).some((value) => !HEX.test(value)))) fail("E_EXPECTED_HASHES");
  const sources = [];
  const chunks = [];
  let totalBytes = 0;
  for (const [sourceIndex, relativePath] of HERMES_THEORY_SOURCE_ALLOWLIST.entries()) {
    const source = readSource(sourceRoot, relativePath);
    totalBytes += source.bytes;
    if (totalBytes > HERMES_THEORY_LIMITS.totalSourceBytes) fail("E_TOTAL_SIZE");
    if (expectedSourceHashes && expectedSourceHashes[relativePath] !== source.sha256) fail("E_SOURCE_HASH_MISMATCH");
    const id = sourceId(relativePath, source.sha256);
    sources.push({ id, relativePath, sourceLabel: SOURCE_LABELS[sourceIndex], sha256: source.sha256, bytes: source.bytes, authority: "supplement" });
    for (const [index, text] of splitText(source.text).entries()) {
      chunks.push({ id: chunkId(id, index, text), sourceId: id, index, text, sha256: hash(text), authority: "supplement" });
      if (chunks.length > HERMES_THEORY_LIMITS.chunks) fail("E_CHUNK_LIMIT");
    }
  }
  const payload = { schemaVersion: HERMES_THEORY_SCHEMA_VERSION, classification: "server-private", authority: "supplement", sources, chunks };
  const artifact = { ...payload, artifactSha256: hash(stableJson(payload)) };
  validateHermesTheoryArtifact(artifact);
  return artifact;
}

export function validateHermesTheoryArtifact(artifact) {
  if (artifact?.schemaVersion === HERMES_THEORY_CURATED_SCHEMA_VERSION) return validateCuratedArtifact(artifact);
  if (!exactKeys(artifact, ["schemaVersion", "classification", "authority", "sources", "chunks", "artifactSha256"])
    || artifact.schemaVersion !== HERMES_THEORY_SCHEMA_VERSION || artifact.classification !== "server-private" || artifact.authority !== "supplement"
    || !Array.isArray(artifact.sources) || artifact.sources.length !== HERMES_THEORY_SOURCE_ALLOWLIST.length
    || !Array.isArray(artifact.chunks) || artifact.chunks.length < artifact.sources.length || artifact.chunks.length > HERMES_THEORY_LIMITS.chunks
    || !HEX.test(artifact.artifactSha256)) fail("E_ARTIFACT_SCHEMA");
  let totalBytes = 0;
  const sourceMap = new Map();
  for (const [index, source] of artifact.sources.entries()) {
    if (!exactKeys(source, ["id", "relativePath", "sourceLabel", "sha256", "bytes", "authority"])
      || source.relativePath !== HERMES_THEORY_SOURCE_ALLOWLIST[index] || source.sourceLabel !== SOURCE_LABELS[index]
      || source.authority !== "supplement" || !HEX.test(source.sha256) || !OPAQUE_SOURCE.test(source.id)
      || source.id !== sourceId(source.relativePath, source.sha256) || !Number.isSafeInteger(source.bytes)
      || source.bytes <= 0 || source.bytes > HERMES_THEORY_LIMITS.fileBytes) fail("E_ARTIFACT_SOURCE");
    totalBytes += source.bytes;
    sourceMap.set(source.id, source);
  }
  if (totalBytes > HERMES_THEORY_LIMITS.totalSourceBytes || sourceMap.size !== artifact.sources.length) fail("E_ARTIFACT_SOURCE");
  const ids = new Set();
  const nextIndex = new Map();
  const sourceTexts = new Map();
  for (const chunk of artifact.chunks) {
    if (!exactKeys(chunk, ["id", "sourceId", "index", "text", "sha256", "authority"])
      || !sourceMap.has(chunk.sourceId) || chunk.authority !== "supplement" || !OPAQUE_CHUNK.test(chunk.id)
      || !Number.isSafeInteger(chunk.index) || chunk.index !== (nextIndex.get(chunk.sourceId) || 0)
      || typeof chunk.text !== "string" || chunk.text.length > HERMES_THEORY_LIMITS.chunkCharacters * 2
      || [...chunk.text].length > HERMES_THEORY_LIMITS.chunkCharacters
      || !HEX.test(chunk.sha256) || hash(chunk.text) !== chunk.sha256
      || chunk.id !== chunkId(chunk.sourceId, chunk.index, chunk.text) || ids.has(chunk.id)) fail("E_ARTIFACT_CHUNK");
    assertModelText(chunk.text);
    ids.add(chunk.id);
    nextIndex.set(chunk.sourceId, chunk.index + 1);
    sourceTexts.set(chunk.sourceId, `${sourceTexts.get(chunk.sourceId) || ""}${chunk.text}`);
  }
  if (nextIndex.size !== sourceMap.size) fail("E_ARTIFACT_COVERAGE");
  // Reject sensitive tokens spanning a chunk boundary in a hostile artifact.
  for (const text of sourceTexts.values()) assertModelText(text);
  const { artifactSha256, ...payload } = artifact;
  if (hash(stableJson(payload)) !== artifactSha256) fail("E_ARTIFACT_HASH_MISMATCH");
  if (Buffer.byteLength(JSON.stringify(artifact), "utf8") > HERMES_THEORY_LIMITS.artifactBytes) fail("E_ARTIFACT_SIZE");
  return artifact;
}

export function hermesTheoryModelView(artifact) {
  validateHermesTheoryArtifact(artifact);
  return artifact.chunks.map(({ id, text }) => ({ id, text, authority: "supplement" }));
}

export function summarizeHermesTheoryArtifact(artifact) {
  validateHermesTheoryArtifact(artifact);
  return { schemaVersion: artifact.schemaVersion, authority: "supplement", sourceCount: artifact.sources.length,
    sourceBytes: artifact.sources.reduce((total, source) => total + (source.original?.bytes ?? source.bytes), 0), chunkCount: artifact.chunks.length, artifactSha256: artifact.artifactSha256 };
}

function assertPrivateOutputParent(parent) {
  directoryChain(parent);
  if (parent.split(path.sep).some((part) => /^(?:public|public_html|www|htdocs|web_dist)$/iu.test(part))) fail("E_OUTPUT_PUBLIC");
  let current = parent;
  while (true) {
    try { fs.lstatSync(path.join(current, ".git")); fail("E_OUTPUT_GIT"); }
    catch (error) { if (error instanceof HermesTheoryArtifactError) throw error; if (error.code !== "ENOENT") fail("E_OUTPUT_CHECK"); }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  const stat = fs.lstatSync(parent);
  if ((stat.mode & 0o777) !== 0o700 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("E_OUTPUT_PERMISSIONS");
  return stat;
}

export function writeHermesTheoryArtifact(artifact, outputPath) {
  if (typeof fs.constants.O_NOFOLLOW !== "number" || typeof process.getuid !== "function") fail("E_PLATFORM_UNSUPPORTED");
  validateHermesTheoryArtifact(artifact);
  if (typeof outputPath !== "string" || !path.isAbsolute(outputPath) || path.resolve(outputPath) !== outputPath || path.extname(outputPath) !== ".json") fail("E_OUTPUT_PATH");
  const parent = path.dirname(outputPath);
  const parentBefore = assertPrivateOutputParent(parent);
  try { fs.lstatSync(outputPath); fail("E_OUTPUT_EXISTS"); }
  catch (error) { if (error instanceof HermesTheoryArtifactError) throw error; if (error.code !== "ENOENT") fail("E_OUTPUT_CHECK"); }
  const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`, "utf8");
  if (bytes.length > HERMES_THEORY_LIMITS.artifactBytes) fail("E_ARTIFACT_SIZE");
  let descriptor;
  let created;
  try {
    descriptor = fs.openSync(outputPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = fs.fstatSync(descriptor);
    fs.fchmodSync(descriptor, 0o600);
    const parentAfter = assertPrivateOutputParent(parent);
    if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) fail("E_OUTPUT_CHANGED");
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const named = fs.lstatSync(outputPath);
    if (named.isSymbolicLink() || named.dev !== created.dev || named.ino !== created.ino || named.nlink !== 1
      || (named.mode & 0o777) !== 0o600 || fs.realpathSync(outputPath) !== outputPath) fail("E_OUTPUT_CHANGED");
    return summarizeHermesTheoryArtifact(artifact);
  } catch (error) {
    if (created) {
      try { const named = fs.lstatSync(outputPath); if (!named.isSymbolicLink() && named.dev === created.dev && named.ino === created.ino) fs.unlinkSync(outputPath); } catch { /* No broad cleanup or overwrite. */ }
    }
    if (error instanceof HermesTheoryArtifactError) throw error;
    fail(error.code === "EEXIST" ? "E_OUTPUT_EXISTS" : "E_OUTPUT_WRITE");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
