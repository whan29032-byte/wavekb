import { gatewayRequestOrigin } from "@/lib/auth/gateway-origin";
import { hashDiscordLinkToken, isDiscordLinkToken } from "@/lib/discord-integration/security";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirect(request: Request, pathname: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(pathname, request.url).toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

function errorStatus(message: string) {
  const mappings = [
    ["discord_link_token_expired", "expired"],
    ["discord_link_token_used", "used"],
    ["discord_link_token_revoked", "revoked"],
    ["discord_identity_already_linked", "conflict"],
    ["account_restricted", "restricted"],
    ["discord_link_token_invalid", "invalid"],
  ] as const;
  return mappings.find(([code]) => message.includes(code))?.[1] ?? "error";
}

export async function POST(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  if (!request.headers.get("origin") || !gatewayRequestOrigin(request.headers, requestOrigin, "")) {
    return json({ error: "cross_origin_request" }, 403);
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (!isDiscordLinkToken(token)) {
    return redirect(request, "/account/discord-link?status=invalid");
  }

  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) {
    return redirect(request, `/login?next=${encodeURIComponent("/account/discord-link")}`);
  }

  const result = await client.rpc("redeem_discord_link_token", {
    p_token_hash: hashDiscordLinkToken(token),
  });
  if (result.error) {
    return redirect(request, `/account/discord-link?status=${errorStatus(result.error.message)}`);
  }
  return redirect(request, "/account/discord-link?status=linked");
}
