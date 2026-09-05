"use client";

/* eslint-disable @next/next/no-img-element -- Public user sticker URLs are dynamic Supabase objects. */

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { ImageSquare, PaperPlaneRight, Trash, X } from "@phosphor-icons/react";
import type { ChatSticker, DirectConversation, DirectMessage } from "@wavekb/domain";
import { Button, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { publicChatStickerUrl } from "@/lib/env";
import { customStickerToken, deleteChatSticker, uploadChatSticker } from "@/lib/member/chat-stickers";
import { playSocialTone } from "@/hooks/use-social-sound";
import { useChatIdentities } from "@/hooks/use-chat-identities";
import { hasFileTransfer, imageFromTransfer } from "@/lib/member/chat-transfer";
import { MessageBody, chatStickers as stickers } from "@/components/chat-message-body";
import { AvatarFrame, IdentityName, Nameplate } from "@/components/nameplate";

function threadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/accepted friendship|required|conversation not found/i.test(message)) return "这段会话当前不可用，请确认好友关系仍然有效。";
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  return "消息没有完成同步，请稍后重试。";
}

export function MessageThread({ actorId, conversation, initialMessages, initialCustomStickers }: {
  actorId: string;
  conversation: DirectConversation;
  initialMessages: DirectMessage[];
  initialCustomStickers: ChatSticker[];
}) {
  const identities = useChatIdentities([conversation.other_id]);
  const profile = { ...conversation, ...identities[conversation.other_id] };
  const [messages, setMessages] = useState(initialMessages);
  const [customStickers, setCustomStickers] = useState(initialCustomStickers);
  const [body, setBody] = useState("");
  const [stagedSticker, setStagedSticker] = useState<ChatSticker | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [draggingImage, setDraggingImage] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const previousNewestId = useRef(initialMessages.at(-1)?.id ?? 0);
  const refreshing = useRef(false);
  const nearBottom = useRef(true);
  const active = useRef(true);

  async function refresh(markRead = true) {
    if (refreshing.current) return;
    refreshing.current = true;
    const client = createClient();
    try {
      const afterId = previousNewestId.current;
      let result = afterId > 0
        ? await client.rpc("list_conversation_messages_after", { p_conversation: conversation.conversation_id, p_after_id: afterId })
        : await client.rpc("list_conversation_messages", { p_conversation: conversation.conversation_id });
      if (result.error && afterId > 0) {
        result = await client.rpc("list_conversation_messages", { p_conversation: conversation.conversation_id });
      }
      if (result.error) throw result.error;
      if (!active.current) return;
      const rows = (result.data ?? []) as DirectMessage[];
      if (rows.length && afterId > 0 && rows.every((row) => row.id > afterId)) {
        setMessages((current) => [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))]);
      } else if (rows.length) {
        setMessages(rows);
      }
      const newest = rows.at(-1);
      if (newest && newest.id !== afterId && newest.sender_id !== actorId && afterId) playSocialTone(560);
      previousNewestId.current = newest?.id ?? afterId;
      if (markRead && previousNewestId.current && document.visibilityState === "visible" && nearBottom.current) {
        await client.rpc("mark_conversation_read_v1", { p_conversation: conversation.conversation_id, p_through_id: previousNewestId.current });
      }
    } finally {
      refreshing.current = false;
    }
  }

  useEffect(() => {
    active.current = true;
    const newest = initialMessages.at(-1);
    if (newest) {
      queueMicrotask(() => { if (active.current && document.visibilityState === "visible") void createClient().rpc("mark_conversation_read_v1", {
        p_conversation: conversation.conversation_id,
        p_through_id: newest.id,
      }); });
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 7000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh().catch(() => undefined); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active.current = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
    // The conversation id is immutable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.conversation_id]);

  useEffect(() => { if (nearBottom.current) endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  async function send(value: string, allowCurrentUpload = false) {
    const normalized = (stagedSticker ? customStickerToken(stagedSticker) : value).trim();
    if (!normalized || normalized.length > 4000 || (pending && !allowCurrentUpload)) return;
    setPending(true);
    setError("");
    try {
      const result = await createClient().rpc("send_direct_message", { p_conversation: conversation.conversation_id, p_body: normalized });
      if (result.error) throw result.error;
      playSocialTone(760);
      setBody("");
      setStagedSticker(null);
      nearBottom.current = true;
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

  async function addImage(file: File) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const sticker = await uploadChatSticker(createClient(), actorId, file);
      setCustomStickers((current) => [sticker, ...current]);
      setStagedSticker(sticker);
      setPending(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片上传失败，请稍后重试。");
      setPending(false);
    }
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFromTransfer(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void addImage(file);
  }

  function dropImage(event: DragEvent<HTMLFormElement>) {
    setDraggingImage(false);
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    const file = imageFromTransfer(event.dataTransfer);
    if (file) void addImage(file);
    else setError("仅支持 GIF、WebP、PNG 或 JPEG 图片。");
  }

  function messageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(body);
    }
  }

  async function removeSticker(sticker: ChatSticker) {
    if (!window.confirm(`从我的表情中移除“${sticker.label}”？`)) return;
    setPending(true);
    setError("");
    try {
      await deleteChatSticker(createClient(), sticker);
      setCustomStickers((current) => current.filter((item) => item.id !== sticker.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "表情移除失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid min-h-[65dvh] grid-rows-[auto_1fr_auto] overflow-hidden rounded-xl border bg-surface" aria-labelledby="conversation-title">
      <header className="flex items-center gap-3 border-b p-4 md:p-5">
        <AvatarFrame profile={profile} size="medium" />
        <div className="min-w-0" id="conversation-title"><IdentityName profile={profile} as="h1" className="truncate text-lg font-semibold" />{profile.public_uid ? <Link href={`/member/${profile.public_uid}`} className="mt-1 block hover:underline"><Nameplate uid={profile.public_uid} style={profile.nameplate_style} compact /></Link> : null}</div>
      </header>

      <div className="grid max-h-[60dvh] content-start gap-3 overflow-y-auto p-4 md:p-6" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        {messages.length ? messages.map((message) => {
          const mine = message.sender_id === actorId;
          return <article key={message.id} className={`grid max-w-[85%] gap-1 ${mine ? "ml-auto justify-items-end" : "mr-auto"}`}><div className={`rounded-xl px-4 py-3 ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}><MessageBody body={message.body} /></div><time dateTime={message.created_at} className="text-[11px] text-muted-foreground">{new Date(message.created_at).toLocaleString("zh-CN")}</time></article>;
        }) : <p className="m-auto text-sm text-muted-foreground">你们已经是好友，发送第一条消息吧。</p>}
        <div ref={endRef} />
      </div>

      <form className={`grid gap-3 border-t p-4 ${draggingImage ? "bg-primary/5 ring-2 ring-inset ring-primary/35" : ""}`} onSubmit={submit} onDragOver={(event) => { if (hasFileTransfer(event.dataTransfer)) { event.preventDefault(); setDraggingImage(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImage(false); }} onDrop={dropImage}>
        <div className="flex flex-wrap gap-1" aria-label="快捷表情">{Object.entries(stickers).map(([id, sticker]) => <Button key={id} type="button" variant="ghost" size="icon" aria-label={`加入${sticker.label}`} onClick={() => setBody((value) => `${value}${sticker.glyph}`)} disabled={pending}><span aria-hidden className="text-xl">{sticker.glyph}</span></Button>)}</div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-muted-foreground">我的表情</span><span className="text-xs text-muted-foreground">粘贴或拖入图片即可加入</span></div>
          {customStickers.length ? <div className="flex gap-2 overflow-x-auto pb-1" aria-label="自定义表情">{customStickers.map((sticker) => <div key={sticker.id} className="group relative shrink-0"><button type="button" className="grid size-14 place-items-center overflow-hidden rounded-lg border bg-muted hover:border-primary" aria-label={`加入待发送区：${sticker.label}`} disabled={pending} onClick={() => setStagedSticker(sticker)}><img src={publicChatStickerUrl(sticker.storage_path)} alt="" className="max-h-full max-w-full object-contain" /></button><button type="button" className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-destructive text-destructive-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100" aria-label={`移除${sticker.label}`} disabled={pending} onClick={() => void removeSticker(sticker)}><Trash aria-hidden size={11} /></button></div>)}</div> : <p className="text-xs text-muted-foreground">直接把截图粘贴或拖入消息框，可保存为自定义表情。</p>}
          {stagedSticker ? <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">待发送：{stagedSticker.label}<button type="button" className="ml-auto" onClick={() => setStagedSticker(null)} aria-label="移除待发送图片"><X aria-hidden size={15} /></button></p> : null}
        </div>
        <Label htmlFor="direct-message" className="sr-only">消息</Label>
        <div className="flex items-end gap-2"><Textarea id="direct-message" value={body} disabled={Boolean(stagedSticker)} onChange={(event) => setBody(event.target.value)} onPaste={pasteImage} onKeyDown={messageKeyDown} maxLength={4000} rows={2} className="min-h-20" placeholder={draggingImage ? "松开即可加入待发送区" : "输入消息，Enter 发送，Shift + Enter 换行"} /><Button type="submit" size="icon" className="mb-0.5 size-11" disabled={pending || (!body.trim() && !stagedSticker)} aria-label="发送消息"><PaperPlaneRight aria-hidden size={20} /></Button></div>
        {draggingImage ? <p className="flex items-center gap-2 text-xs font-medium text-primary"><ImageSquare aria-hidden size={16} />松开即可加入待发送区</p> : null}
        {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      </form>
    </section>
  );
}
