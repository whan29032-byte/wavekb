import { authorizeDiscordBot } from "@/lib/discord-integration/security";
import { discordErrorResponse, getDiscordMember } from "@/lib/discord-integration/service";

export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    if (!authorizeDiscordBot(request.headers)) {
      return json({ error: "unauthorized" }, 401);
    }
  } catch {
    return json({ error: "integration_unavailable" }, 503);
  }

  try {
    const discordUserId = new URL(request.url).searchParams.get("discordUserId");
    const member = await getDiscordMember(discordUserId);
    return json({ linked: true, member });
  } catch (error) {
    const response = discordErrorResponse(error);
    return json({ error: response.code }, response.status);
  }
}
