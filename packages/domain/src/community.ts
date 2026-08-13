export const BOARDS = {
  case_submission: {
    title: "提交案例",
    description: "分享行情图、浪型标注与案例分析。",
  },
  idea_sharing: {
    title: "思路分享",
    description: "分享理论理解、判断思路与复盘总结。",
  },
  public_viewpoint: {
    title: "公开观点",
    description: "发布可讨论、可追踪并可在个人主页沉淀的市场观点。",
  },
  question_answers: {
    title: "问题解答",
    description: "把一个明确的波浪问题交给社区，收到基于规则和证据的回答。",
  },
  review_answers: {
    title: "复盘解答",
    description: "围绕已完成的复盘核验计数、规则和执行偏差。",
  },
} as const;

export type BoardSlug = keyof typeof BOARDS;
export const BOARD_SLUGS = Object.keys(BOARDS) as BoardSlug[];

export type ExternalKind = "youtube" | "x" | null;

export type PublicProfile = {
  id: string;
  public_uid: number | null;
  display_name: string;
  avatar_url: string | null;
  role: string;
};

export type PostImage = {
  id: string;
  storage_path: string;
  sort_order: number;
};

export type CommunityPost = {
  id: string;
  board: BoardSlug;
  title: string;
  body: string;
  author_id: string;
  status: "draft" | "published" | "hidden";
  created_at: string;
  updated_at: string;
  external_url: string | null;
  external_kind: ExternalKind;
  chart_package: Record<string, unknown> | null;
  post_images: PostImage[];
  profiles: PublicProfile | null;
};

export type PostInput = {
  board: string;
  title: string;
  body: string;
  externalUrl?: string;
  imageCount?: number;
  mode?: "simple" | "professional";
};

export type PostValidation = {
  ok: boolean;
  fields: Partial<Record<"board" | "title" | "body" | "externalUrl", string>>;
  value: {
    board: BoardSlug | null;
    title: string;
    body: string;
    externalUrl: string;
    externalKind: ExternalKind;
  };
};

export const MAX_IMAGES = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isBoardSlug(value: string): value is BoardSlug {
  return Object.prototype.hasOwnProperty.call(BOARDS, value);
}

export function parseExternalReference(rawUrl: string | undefined): {
  ok: boolean;
  url: string;
  kind: ExternalKind;
  error?: string;
} {
  const value = String(rawUrl ?? "").trim();
  if (!value) return { ok: true, url: "", kind: null };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, url: "", kind: null, error: "外部引用需要填写完整的 https 链接。" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, url: "", kind: null, error: "外部引用只支持 https 链接。" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (["youtube.com", "youtu.be", "m.youtube.com"].includes(host)) {
    return { ok: true, url: parsed.toString(), kind: "youtube" };
  }
  if (["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
    return { ok: true, url: parsed.toString(), kind: "x" };
  }
  return { ok: false, url: "", kind: null, error: "目前只支持引用 YouTube 视频或 X 帖子。" };
}

export function validatePost(input: PostInput): PostValidation {
  const fields: PostValidation["fields"] = {};
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  const board = isBoardSlug(input.board) ? input.board : null;

  if (!board) fields.board = "请选择有效板块。";
  if (title.length < 5 || title.length > 120) fields.title = "标题需要 5-120 个字符。";

  const minimumBodyLength = input.mode === "simple" && Number(input.imageCount ?? 0) > 0 ? 2 : 20;
  if (body.length < minimumBodyLength || body.length > 20_000) {
    fields.body = minimumBodyLength === 2
      ? "简易发布附图时，正文至少需要 2 个字符。"
      : "正文需要 20-20000 个字符。";
  }

  const external = parseExternalReference(input.externalUrl);
  if (!external.ok) fields.externalUrl = external.error;

  return {
    ok: Object.keys(fields).length === 0,
    fields,
    value: {
      board,
      title,
      body,
      externalUrl: external.ok ? external.url : "",
      externalKind: external.ok ? external.kind : null,
    },
  };
}

export function validateImages(files: Iterable<Pick<File, "type" | "size">>): string | null {
  const items = Array.from(files);
  if (items.length > MAX_IMAGES) return "每篇帖子最多上传 9 张图片。";
  if (items.some((file) => !IMAGE_TYPES.has(file.type))) return "图片只支持 JPG、PNG 或 WebP。";
  if (items.some((file) => file.size > MAX_IMAGE_BYTES)) return "单张图片不能超过 10 MiB。";
  return null;
}

export function plainTextExcerpt(value: string, limit = 140): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
