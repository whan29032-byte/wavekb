import { authorizeDiscordBot } from "@/lib/discord-integration/security";
import { createDiscordLink, discordErrorResponse } from "@/lib/discord-integration/service";

export const dynamic = "force-dynamic";

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

  const body = await request.json().catch(() => null) as {
    discordUserId?: unknown;
    guildId?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return json({ error: "invalid_request" }, 400);
  }

  try {
    const result = await createDiscordLink({
      discordUserId: body.discordUserId,
      guildId: body.guildId,
      requestOrigin: new URL(request.url).origin,
    });
    return json(result);
  } catch (error) {
    const response = discordErrorResponse(error);
    return json({ error: response.code }, response.status);
  }
}
