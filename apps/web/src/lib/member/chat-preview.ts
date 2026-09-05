export const chatStickers = {
  wave: { glyph: "🌊", label: "波浪" },
  "chart-up": { glyph: "📈", label: "上涨" },
  "chart-down": { glyph: "📉", label: "下跌" },
  target: { glyph: "🎯", label: "目标" },
  fire: { glyph: "🔥", label: "精彩" },
  thinking: { glyph: "🤔", label: "思考" },
  agree: { glyph: "🤝", label: "赞同" },
  check: { glyph: "✅", label: "确认" },
  diamond: { glyph: "💎", label: "高质量" },
  laugh: { glyph: "😂", label: "开心" },
} as const;

export function standardSticker(body: string) {
  const match = /^\[\[sticker:([a-z0-9-]+)\]\]$/.exec(body.trim());
  return match ? chatStickers[match[1] as keyof typeof chatStickers] ?? null : null;
}

export function customSticker(body: string): { path: string; label: string } | null {
  const match = /^\[\[custom-sticker:([^|\]]+)\|([^\]]*)\]\]$/.exec(body.trim());
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[1]);
    const label = decodeURIComponent(match[2]) || "自定义表情";
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp)$/i.test(path)) return null;
    return { path, label: label.slice(0, 40) };
  } catch {
    return null;
  }
}

export function chatPreview(text: string | null | undefined): string {
  if (!text) return "还没有消息";
  const sticker = standardSticker(text);
  if (sticker) return `${sticker.glyph} ${sticker.label}`;
  const custom = customSticker(text);
  return custom ? `[表情] ${custom.label}` : text;
}
