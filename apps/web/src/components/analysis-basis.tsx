import { useId } from "react";

type PublicAnalysisBasisItem = {
  kind: "structure" | "hypothesis";
  summary: string;
  conditions: string[];
  invalidations: string[];
};

const BASIS_KEYS = new Set(["kind", "summary", "conditions", "invalidations"]);
const SOURCE_MARKERS = /(?:https?:\/\/|file:\/\/|www\.|\/(?:Users|home|var|tmp|private|opt|srv|mnt|etc)\/|(?:^|[\s("'：:])(?:~\/|\.\.?\/)|[a-z]:[\\/]|\/knowledge\/|(?:knowledge|citation|source|book|document|chunk)_(?:id|ids|path|title)|\b(?:unit-ewp-|private-(?:source|kb)-|local-(?:source|kb)-|citation[-_:])|\.(?:pdf|epub|docx?|md|jsonl?|ya?ml|txt)(?:$|[\s"'）)\]，。:：]))/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// This is a display-side guard, not the privacy boundary. The server must
// remove private titles, provenance, and unsupported claims before delivery.
export function isPublicAnalysisText(value: unknown, limit = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(value)
    && !SOURCE_MARKERS.test(value);
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 6
    && value.every((item) => isPublicAnalysisText(item, 280));
}

function isBasisItem(value: unknown): value is PublicAnalysisBasisItem {
  return isRecord(value) && Object.keys(value).every((key) => BASIS_KEYS.has(key))
    && (value.kind === "structure" || value.kind === "hypothesis")
    && isPublicAnalysisText(value.summary) && isTextList(value.conditions) && isTextList(value.invalidations);
}

export function hasPublicAnalysisContract(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schema_version === "wavekb-public-analysis-v1"
    && (value.source_visibility === "private_research" || value.source_visibility === "public_books");
}

export function AnalysisBasis({ output }: { output?: unknown }) {
  const headingId = useId();
  if (!hasPublicAnalysisContract(output) || !Array.isArray(output.analysis_basis)
    || output.analysis_basis.length > 12) return null;
  const items = output.analysis_basis.filter(isBasisItem);
  if (!items.length) return null;

  return <section className="grid min-w-0 gap-3 border-t pt-4" aria-labelledby={headingId}>
    <h3 id={headingId} className="font-semibold">分析依据</h3>
    <p className="text-xs leading-5 text-muted-foreground">结构判断基于本次分析输入；候选假设尚未复核，不等同于已验证的学习成果。</p>
    <ul className="grid gap-3">{items.map((item, index) => <li key={index} className="grid min-w-0 gap-3 rounded-lg bg-background p-3 text-sm leading-6">
      <span className="w-fit rounded-md border bg-surface px-2 py-1 text-xs font-semibold">{item.kind === "structure" ? "结构判断" : "候选假设（未验证）"}</span>
      <p className="break-words">{item.summary}</p>
      {item.conditions.length ? <div className="grid gap-1"><p className="font-semibold">成立条件</p><ul className="list-disc space-y-1 pl-5">{item.conditions.map((condition, conditionIndex) => <li key={conditionIndex} className="break-words">{condition}</li>)}</ul></div> : null}
      {item.invalidations.length ? <div className="grid gap-1"><p className="font-semibold">失效条件</p><ul className="list-disc space-y-1 pl-5">{item.invalidations.map((invalidation, invalidationIndex) => <li key={invalidationIndex} className="break-words">{invalidation}</li>)}</ul></div> : null}
    </li>)}</ul>
  </section>;
}
