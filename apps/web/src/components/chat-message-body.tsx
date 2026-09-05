/* eslint-disable @next/next/no-img-element -- Public user sticker URLs are dynamic Supabase objects. */

import { publicChatStickerUrl } from "@/lib/env";

import { standardSticker, customSticker } from "@/lib/member/chat-preview";
export { chatStickers } from "@/lib/member/chat-preview";

export function MessageBody({ body }: { body: string }) {
  const sticker = standardSticker(body);
  if (sticker) return <span role="img" aria-label={sticker.label} className="text-4xl leading-none">{sticker.glyph}</span>;
  const custom = customSticker(body);
  if (custom) {
    return <img src={publicChatStickerUrl(custom.path)} alt={custom.label} className="max-h-44 max-w-44 rounded-lg object-contain" />;
  }
  return <p className="whitespace-pre-wrap break-words text-sm leading-6">{body}</p>;
}
