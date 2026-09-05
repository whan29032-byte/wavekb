import { TlineClient } from "../apps/web/src/lib/tline/client.ts";

try {
  const client = new TlineClient();
  const institutions = await client.institutions();
  console.log(`Tline institutions verified: ${institutions.length}`);
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const names = new Map(institutions.map((row) => [row.slug, row.name]));
  let count = 0;
  for await (const row of client.researchSince(since)) {
    const title = typeof row.title === "string" ? row.title : row.title?.zh || row.title?.en || "未提供标题";
    const institution = row.institution?.name || names.get(row.institution?.slug) || "未提供机构";
    // JSON-escape controls so untrusted upstream text cannot inject terminal escapes.
    console.log(JSON.stringify({ title, institution })); count++;
  }
  console.log(`Read ${count} research reports since ${since}; pagination complete.`);
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || "client_error", message: error.message }, status: error.status, retryAfterSeconds: error.retryAfterSeconds }));
  process.exitCode = 1;
}
