type FetchLike = typeof fetch;

export type DirectoryPlatform = "x" | "discord";

export type DirectoryResourceInput = {
  platform: DirectoryPlatform;
  name: string;
  description: string;
  url: string;
  avatar_url: string | null;
  active: boolean;
  sort_order: number;
};

const X_HOSTS = new Set(["x.com", "twitter.com"]);
const DISCORD_HOSTS = new Set(["discord.com", "discord.gg"]);
const AVATAR_HOSTS = new Set([
  "unavatar.io",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "pbs.twimg.com",
  "abs.twimg.com",
  "substackcdn.com",
]);

function failure(code: string, statusCode = 400): never {
  throw Object.assign(new Error(code), { statusCode });
}

function text(value: unknown, maximum: number): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function httpsUrl(value: unknown): URL {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    return failure("invalid_resource_url");
  }
  if (parsed.protocol !== "https:") return failure("invalid_resource_url");
  parsed.hash = "";
  return parsed;
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function xHandleFromUrl(value: unknown): string {
  const url = httpsUrl(value);
  if (!X_HOSTS.has(hostOf(url))) return failure("invalid_resource_url");
  const handle = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "")
    .replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return failure("invalid_resource_url");
  return handle;
}

export function discordInviteCode(value: unknown): string {
  const url = httpsUrl(value);
  const host = hostOf(url);
  if (!DISCORD_HOSTS.has(host)) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const candidate = host === "discord.gg"
    ? parts[0]
    : parts[0] === "invite"
      ? parts[1]
      : "";
  const code = candidate ?? "";
  return /^[A-Za-z0-9_-]{2,64}$/.test(code) ? code : "";
}

function avatarUrl(value: unknown): string | null {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  const parsed = httpsUrl(candidate);
  if (!AVATAR_HOSTS.has(hostOf(parsed))) return failure("invalid_avatar_url");
  return parsed.toString();
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json",
        "user-agent": "WaveKB-Directory/1.0",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

type DiscordGuild = {
  id?: string;
  name?: string;
  description?: string | null;
  icon?: string | null;
};

async function discordGuildFromInvite(
  code: string,
  fetchImpl: FetchLike,
): Promise<DiscordGuild | null> {
  if (!code) return null;
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return null;
    const payload = await response.json() as { guild?: DiscordGuild };
    return payload.guild || null;
  } catch {
    return null;
  }
}

function discordPageMetadata(html: string): {
  inviteCode: string;
  name: string;
  description: string;
  avatar: string | null;
} {
  const clean = String(html || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");
  const inviteCode = clean.match(/https:\/\/discord\.gg\/([A-Za-z0-9_-]{2,64})/i)?.[1] || "";
  const avatar = clean.match(
    /https:\/\/cdn\.discordapp\.com\/icons\/\d+\/[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)(?:\?[^"' <\\]*)?/i,
  )?.[0] || null;
  const meta = (property: string): string => {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    return clean.match(pattern)?.[1]?.trim() || "";
  };
  return {
    inviteCode,
    name: meta("og:title").replace(/\s*-\s*Discord Servers?\s*$/i, ""),
    description: meta("og:description"),
    avatar,
  };
}

function discordAvatar(guild: DiscordGuild | null): string | null {
  return guild?.id && guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`
    : null;
}

async function discordMetadata(
  url: URL,
  fetchImpl: FetchLike,
): Promise<{ name: string; description: string; avatar: string | null }> {
  const host = hostOf(url);
  if (!DISCORD_HOSTS.has(host)) return failure("invalid_resource_url");
  let code = discordInviteCode(url.toString());
  let page = { inviteCode: "", name: "", description: "", avatar: null as string | null };
  if (!code) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url.toString());
      if (response.ok) page = discordPageMetadata(await response.text());
    } catch {
      // The directory can still save a valid Discord URL with an initial fallback.
    }
    code = page.inviteCode;
  }
  const guild = await discordGuildFromInvite(code, fetchImpl);
  const slug = url.pathname.split("/").filter(Boolean).at(-1) || "Discord 社区";
  return {
    name: text(guild?.name || page.name || slug.replace(/-\d+$/, "").replace(/-/g, " "), 120),
    description: text(guild?.description || page.description || "", 300),
    avatar: discordAvatar(guild) || page.avatar,
  };
}

export async function normalizeDirectoryResource(
  input: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<DirectoryResourceInput> {
  const platform = String(input.platform || "").trim().toLowerCase();
  if (platform !== "x" && platform !== "discord") return failure("invalid_platform");
  const url = httpsUrl(input.url);
  const active = input.active === undefined ? true : input.active === true;
  const sortOrder = input.sort_order === undefined ? 100 : Number(input.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
    return failure("invalid_sort_order");
  }

  let generatedName = "";
  let generatedDescription = "";
  let generatedAvatar: string | null = null;
  if (platform === "x") {
    const handle = xHandleFromUrl(url.toString());
    url.hostname = "x.com";
    url.pathname = `/${handle}`;
    url.search = "";
    generatedName = `@${handle}`;
    generatedAvatar = `https://unavatar.io/x/${encodeURIComponent(handle)}`;
  } else {
    const metadata = await discordMetadata(url, fetchImpl);
    generatedName = metadata.name;
    generatedDescription = metadata.description;
    generatedAvatar = metadata.avatar;
  }

  const name = text(input.name || generatedName, 120);
  if (!name) return failure("invalid_resource_name");
  return {
    platform,
    name,
    description: text(input.description || generatedDescription, 300),
    url: url.toString(),
    avatar_url: avatarUrl(input.avatar_url || generatedAvatar),
    active,
    sort_order: sortOrder,
  };
}
