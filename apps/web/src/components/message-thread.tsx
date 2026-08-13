"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { PaperPlaneRight } from "@phosphor-icons/react";
import type { DirectConversation, DirectMessage } from "@wavekb/domain";
import { Button, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { publicChatStickerUrl } from "@/lib/env";

const stickers = {
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

function standardSticker(body: string) {
  const match = /^\[\[sticker:([a-z0-9-]+)\]\]$/.exec(body.trim());
  return match ? stickers[match[1] as keyof typeof stickers] ?? null : null;
}

function customSticker(body: string): { path: string; label: string } | null {
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

function MessageBody({ body }: { body: string }) {
  const sticker = standardSticker(body);
  if (sticker) return <span role="img" aria-label={sticker.label} className="text-4xl leading-none">{sticker.glyph}</span>;
  const custom = customSticker(body);
  if (custom) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={publicChatStickerUrl(custom.path)} alt={custom.label} className="max-h-44 max-w-44 rounded-lg object-contain" />;
  }
  return <p className="whitespace-pre-wrap break-words text-sm leading-6">{body}</p>;
}

function threadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/accepted friendship|required|conversation not found/i.test(message)) return "这段会话当前不可用，请确认好友关系仍然有效。";
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return "消息没有完成同步，请稍后重试。";
}

export function MessageThread({ actorId, conversation, initialMessages }: { actorId: string; conversation: DirectConversation; initialMessages: DirectMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  async function refresh(markRead = true) {
    const client = createClient();
    const result = await client.rpc("list_conversation_messages", { p_conversation: conversation.conversation_id });
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as DirectMessage[];
    setMessages(rows);
    const newest = rows.at(-1);
    if (markRead && newest && document.visibilityState === "visible") {
      await client.rpc("mark_conversation_read_v1", { p_conversation: conversation.conversation_id, p_through_id: newest.id });
    }
  }

  useEffect(() => {
    const newest = initialMessages.at(-1);
    if (newest && document.visibilityState === "visible") {
      queueMicrotask(() => void createClient().rpc("mark_conversation_read_v1", {
        p_conversation: conversation.conversation_id,
        p_through_id: newest.id,
      }));
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 7000);
    return () => window.clearInterval(timer);
    // The conversation id is immutable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.conversation_id]);

  async function send(value: string) {
    const normalized = value.trim();
    if (!normalized || normalized.length > 4000 || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await createClient().rpc("send_direct_message", { p_conversation: conversation.conversation_id, p_body: normalized });
      if (result.error) throw result.error;
      setBody("");
      await refresh(false);
      window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
    } catch (cause) {
      setError(threadError(cause));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(body);
  }

  return (
    <section className="grid min-h-[65dvh] grid-rows-[auto_1fr_auto] overflow-hidden rounded-xl border bg-surface" aria-labelledby="conversation-title">
      <header className="flex items-center gap-3 border-b p-4 md:p-5">
        {conversation.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conversation.avatar_url} alt="" className="size-11 rounded-lg object-cover" />
        ) : <span className="grid size-11 place-items-center rounded-lg bg-muted font-semibold">{conversation.display_name.slice(0, 1)}</span>}
        <div className="min-w-0"><h1 id="conversation-title" className="truncate text-lg font-semibold">{conversation.display_name}</h1>{conversation.public_uid ? <Link href={`/member/${conversation.public_uid}`} className="text-xs text-muted-foreground hover:text-primary hover:underline">UID {conversation.public_uid}</Link> : null}</div>
      </header>

      <div className="grid content-start gap-3 overflow-y-auto p-4 md:p-6" aria-live="polite">
        {messages.length ? messages.map((message) => {
          const mine = message.sender_id === actorId;
          return <article key={message.id} className={`grid max-w-[85%] gap-1 ${mine ? "ml-auto justify-items-end" : "mr-auto"}`}><div className={`rounded-xl px-4 py-3 ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}><MessageBody body={message.body} /></div><time dateTime={message.created_at} className="text-[11px] text-muted-foreground">{new Date(message.created_at).toLocaleString("zh-CN")}</time></article>;
        }) : <p className="m-auto text-sm text-muted-foreground">你们已经是好友，发送第一条消息吧。</p>}
        <div ref={endRef} />
      </div>

      <form className="grid gap-3 border-t p-4" onSubmit={submit}>
        <div className="flex flex-wrap gap-1" aria-label="快捷表情">{Object.entries(stickers).map(([id, sticker]) => <Button key={id} type="button" variant="ghost" size="icon" aria-label={sticker.label} onClick={() => void send(`[[sticker:${id}]]`)} disabled={pending}><span aria-hidden className="text-xl">{sticker.glyph}</span></Button>)}</div>
        <Label htmlFor="direct-message" className="sr-only">消息</Label>
        <div className="flex items-end gap-2"><Textarea id="direct-message" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={2} className="min-h-20" placeholder="输入消息，Enter 换行" /><Button type="submit" size="icon" className="mb-0.5 size-11" disabled={pending || !body.trim()} aria-label="发送消息"><PaperPlaneRight aria-hidden size={20} /></Button></div>
        {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      </form>
    </section>
  );
}
