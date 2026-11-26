import { authorizeDiscordBot } from "@/lib/discord-integration/security";
import { discordErrorResponse, executeDiscordGameAction } from "@/lib/discord-integration/service";

export const dynamic = "force-dynamic";

const maximumRequestBytes = 8192;

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    if (!authorizeDiscordBot(request.headers)) {
      return json({ error: "unauthorized" }, 401);
    }
  } catch {
    return json({ error: "integration_unavailable" }, 503);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) {
    return json({ error: "request_too_large" }, 413);
  }
  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > maximumRequestBytes) {
    return json({ error: "request_too_large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request" }, 400);
  }
  const input = body as Record<string, unknown>;
  try {
    const result = await executeDiscordGameAction({
      discordUserId: input.discordUserId,
      guildId: input.guildId,
      requestId: input.requestId,
      action: input.action,
      payload: input.payload,
    });
    return json({ ok: true, result });
  } catch (error) {
    const response = discordErrorResponse(error);
    return json({ error: response.code }, response.status);
  }
}
