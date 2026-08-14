"use client";

/* eslint-disable @next/next/no-img-element -- Avatars and stickers are user-managed Supabase objects. */

import Link from "next/link";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Bell, ChatCircleDots, Check, DotsThree, MagnifyingGlass, Minus, PaperPlaneRight, PushPin, PushPinSlash, Smiley, SpeakerHigh, SpeakerSlash, UserPlus, UsersThree, X } from "@phosphor-icons/react";
import { formatMentorPrice, type ChatSticker, type DirectConversation, type DirectMessage, type FriendshipConnection, type MemberProfile, type MentorAccess, type MentorPaymentClaim, type MentorStudent, type PublicProfile } from "@wavekb/domain";
import { AvatarFrame, IdentityName, Nameplate } from "@/components/nameplate";
import { publicChatStickerUrl } from "@/lib/env";
import { customStickerToken, uploadChatSticker } from "@/lib/member/chat-stickers";
import { clampPanelCoordinates } from "@/lib/member/social-panel-state";
import { createClient } from "@/lib/supabase/client";
import styles from "./social-desktop.module.css";

type PanelState = { x: number; y: number; open: boolean; minimized: boolean; pinned: boolean; edge: "left" | "right" | "top" | "bottom" };
type OpenChat = DirectConversation & { z: number; minimized?: boolean; maximized?: boolean; pinned?: boolean };
const STORAGE_KEY = "wavekb:social-desktop:v2";
const SOUND_KEY = "wavekb:social-sound:v1";
const emoji = ["🌊", "📈", "📉", "🎯", "🔥", "🤔", "🤝", "✅", "💎", "😂"];

function tone(frequency: number, enabled: boolean) {
  if (!enabled) return;
  try {
    const AudioClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioClass) return;
    const context = new AudioClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.022, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .08);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch { /* Browser sound permission is optional. */ }
}

function errorText(error: unknown) {
  const value = error instanceof Error ? error.message : String(error ?? "");
  if (/mime|type/i.test(value)) return "仅支持 GIF、WebP、PNG 或 JPEG 图片。";
  if (/size|large|exceed/i.test(value)) return "图片超过上传大小限制，请压缩后重试。";
  if (/auth|jwt|permission|row-level/i.test(value)) return "登录状态已失效，请重新登录。";
  if (/friend|accepted|conversation/i.test(value)) return "会话不可用，请确认好友关系仍然有效。";
  return value && value.length < 100 ? value : "操作失败，请稍后重试。";
}

function formatTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function stickerImage(body: string) {
  const match = /^\[\[custom-sticker:([^|\]]+)\|([^\]]*)\]\]$/.exec(body.trim());
  if (!match) return null;
  try { return { path: decodeURIComponent(match[1]), label: decodeURIComponent(match[2]) || "图片" }; } catch { return null; }
}

function ChatBody({ body }: { body: string }) {
  const image = stickerImage(body);
  if (image) return <img src={publicChatStickerUrl(image.path)} alt={image.label} className={styles.messageImage} />;
  const standard = /^\[\[sticker:([a-z0-9-]+)\]\]$/.exec(body.trim());
  if (standard) return <span className={styles.bigEmoji}>{({ wave: "🌊", "chart-up": "📈", "chart-down": "📉", target: "🎯", fire: "🔥", thinking: "🤔", agree: "🤝", check: "✅", diamond: "💎", laugh: "😂" } as Record<string,string>)[standard[1]] || "🙂"}</span>;
  return <p>{body}</p>;
}

function FloatingChat({ actorId, chat, sound, onClose, onFocus, onPatch, onRead }: { actorId: string; chat: OpenChat; sound: boolean; onClose: () => void; onFocus: () => void; onPatch: (value: Partial<OpenChat>) => void; onRead: () => void }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [stickers, setStickers] = useState<ChatSticker[]>([]);
  const [body, setBody] = useState("");
  const [staged, setStaged] = useState<ChatSticker | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const newest = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(() => ({ x: Math.max(12, window.innerWidth - 470 - (chat.z % 3) * 26), y: 92 + (chat.z % 3) * 26 }));
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  async function refresh(markRead = true) {
    const client = createClient();
    const result = await client.rpc("list_conversation_messages", { p_conversation: chat.conversation_id });
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as DirectMessage[];
    const latest = rows.at(-1);
    if (latest && latest.id > newest.current && newest.current && latest.sender_id !== actorId) tone(560, sound);
    newest.current = latest?.id ?? newest.current;
    setMessages(rows);
    if (markRead && latest) {
      const read = await client.rpc("mark_conversation_read_v1", { p_conversation: chat.conversation_id, p_through_id: latest.id });
      if (read.error) throw read.error;
      onRead();
    }
  }

  useEffect(() => {
    const client = createClient();
    const initial = window.setTimeout(() => {
      void Promise.all([
        refresh().catch((cause) => setError(errorText(cause))),
        client.from("chat_stickers").select("id,owner_id,storage_path,label,mime_type,created_at").eq("owner_id", actorId).order("created_at", { ascending: false }).then(({ data }) => setStickers((data ?? []) as ChatSticker[])),
      ]);
    }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(() => undefined); }, 6000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.conversation_id]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages]);
  useEffect(() => {
    if (!emojiOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-emoji-panel],[data-emoji-toggle]")) setEmojiOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [emojiOpen]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const value = staged ? customStickerToken(staged) : body.trim();
    if (!value || pending) return;
    setPending(true); setError("");
    try {
      const result = await createClient().rpc("send_direct_message", { p_conversation: chat.conversation_id, p_body: value });
      if (result.error) throw result.error;
      setBody(""); setStaged(null); tone(760, sound); await refresh(false);
    } catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }

  function imageFromTransfer(transfer: DataTransfer | null) {
    return transfer ? Array.from(transfer.files).find((file) => file.type.startsWith("image/")) ?? null : null;
  }
  async function stageImage(file: File) {
    setPending(true); setError("");
    try {
      const value = await uploadChatSticker(createClient(), actorId, file);
      setStickers((current) => [value, ...current.filter((item) => item.id !== value.id)]);
      setStaged(value);
    } catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) { const file = imageFromTransfer(event.clipboardData); if (file) { event.preventDefault(); void stageImage(file); } }
  function drop(event: DragEvent<HTMLFormElement>) { const file = imageFromTransfer(event.dataTransfer); setDragging(false); if (file) { event.preventDefault(); void stageImage(file); } }

  const windowZ = chat.pinned ? 100 : Math.min(chat.z, 89);
  const style = chat.maximized ? { inset: "4.5rem .75rem .75rem .75rem", zIndex: windowZ } : { left: position.x, top: position.y, zIndex: windowZ };
  return <section ref={windowRef} className={styles.chatWindow} data-minimized={chat.minimized || undefined} data-maximized={chat.maximized || undefined} style={style} onPointerDown={onFocus} aria-label={`与${chat.display_name}聊天`}>
    <header className={styles.windowTitle} onDoubleClick={() => onPatch({ maximized: !chat.maximized, minimized: false })} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button,a")) return; const element = windowRef.current; if (!element || chat.maximized) return; element.setPointerCapture(event.pointerId); const box = element.getBoundingClientRect(); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top }; }} onPointerMove={(event) => { const state = drag.current; const element = windowRef.current; if (!state || !element || state.id !== event.pointerId) return; const next = { x: Math.max(0, Math.min(window.innerWidth - 220, state.left + event.clientX - state.x)), y: Math.max(64, Math.min(window.innerHeight - 42, state.top + event.clientY - state.y)) }; element.style.left = `${next.x}px`; element.style.top = `${next.y}px`; }} onPointerUp={(event) => { const element = windowRef.current; if (drag.current && element) { const box = element.getBoundingClientRect(); setPosition({ x: box.left, y: box.top }); } drag.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }}>
      <AvatarFrame profile={{ display_name: chat.display_name, avatar_url: chat.avatar_url, nameplate_style: chat.nameplate_style }} size="small" />
      <div className={styles.titleCopy}><IdentityName profile={chat} as="strong" /><Nameplate uid={chat.public_uid} style={chat.nameplate_style} compact /></div>
      <div className={styles.windowControls}><button type="button" onClick={() => onPatch({ pinned: !chat.pinned })} aria-label={chat.pinned ? "取消置顶" : "置顶"}>{chat.pinned ? <PushPinSlash /> : <PushPin />}</button><button type="button" onClick={() => onPatch({ minimized: !chat.minimized })} aria-label="最小化"><Minus /></button><button type="button" onClick={() => onPatch({ maximized: !chat.maximized, minimized: false })} aria-label={chat.maximized ? "还原" : "最大化"}><DotsThree /></button><button type="button" onClick={onClose} aria-label="关闭"><X /></button></div>
    </header>
    {!chat.minimized ? <><div className={styles.messages} aria-live="polite">{messages.length ? messages.map((message) => { const mine = message.sender_id === actorId; return <article key={message.id} data-mine={mine || undefined} className={styles.message}><div><ChatBody body={message.body} /></div><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>; }) : <p className={styles.empty}>发送第一条消息吧。</p>}<div ref={end} /></div>
      <form className={styles.composer} data-dragging={dragging || undefined} onSubmit={send} onDragOver={(event) => { if (imageFromTransfer(event.dataTransfer)) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <div className={styles.composerTools}><button type="button" data-emoji-toggle aria-expanded={emojiOpen} aria-label="表情" onClick={() => setEmojiOpen((value) => !value)}><Smiley /></button>{staged ? <span>待发送：{staged.label}<button type="button" onClick={() => setStaged(null)} aria-label="移除待发送图片"><X /></button></span> : <small>可粘贴或拖入图片</small>}</div>
        {emojiOpen ? <div className={styles.emojiPanel} data-emoji-panel role="dialog" aria-label="表情"><div>{emoji.map((item) => <button key={item} type="button" onClick={() => { setBody((value) => `${value}${item}`); setEmojiOpen(false); }}>{item}</button>)}</div>{stickers.length ? <div>{stickers.map((item) => <button key={item.id} type="button" onClick={() => { setStaged(item); setEmojiOpen(false); }}><img src={publicChatStickerUrl(item.storage_path)} alt={item.label} /></button>)}</div> : null}</div> : null}
        <div className={styles.inputRow}><textarea value={body} disabled={Boolean(staged)} maxLength={4000} rows={2} placeholder={dragging ? "松开以加入待发送区" : "输入消息；支持复制、粘贴和截图"} onChange={(event) => setBody(event.target.value)} onPaste={paste} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button type="submit" disabled={pending || (!staged && !body.trim())} aria-label="发送"><PaperPlaneRight /></button></div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </form></> : null}
  </section>;
}

export function SocialDesktop() {
  const [actor, setActor] = useState<PublicProfile | null>(null);
  const [connections, setConnections] = useState<FriendshipConnection[]>([]);
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [teachers, setTeachers] = useState<MentorAccess[]>([]);
  const [students, setStudents] = useState<MentorStudent[]>([]);
  const [paymentClaims, setPaymentClaims] = useState<MentorPaymentClaim[]>([]);
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<"friends" | "new" | "notifications">("friends");
  const [recentOpen, setRecentOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [searchResult, setSearchResult] = useState<MemberProfile | null>(null);
  const [message, setMessage] = useState("");
  const [chats, setChats] = useState<OpenChat[]>([]);
  const [sound, setSound] = useState(() => typeof window === "undefined" || localStorage.getItem(SOUND_KEY) !== "off");
  const [autoHidden, setAutoHidden] = useState(false);
  const [panel, setPanel] = useState<PanelState>(() => {
    const fallback: PanelState = { x: Math.max(12, typeof window === "undefined" ? 900 : window.innerWidth - 324), y: 82, open: true, minimized: false, pinned: true, edge: "right" };
    if (typeof window === "undefined") return fallback;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as { panel?: Partial<PanelState> } | null;
      const restored = stored?.panel ? { ...fallback, ...stored.panel } : fallback;
      return { ...restored, ...clampPanelCoordinates(restored, { width: window.innerWidth, height: window.innerHeight }, { width: 304, height: restored.minimized ? 48 : 520 }) };
    } catch { return fallback; }
  });
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const z = useRef(50);

  async function load() {
    const client = createClient();
    const [session, friendships, modern, mentorAccess, mentorStudents, claims] = await Promise.all([client.auth.getSession(), client.rpc("list_my_friendships"), client.rpc("list_my_conversations_v2"), client.rpc("list_my_mentor_access"), client.rpc("list_my_mentor_students"), client.rpc("list_my_mentor_payment_claims")]);
    const user = session.data.session?.user;
    if (!user) { setActor(null); setConnections([]); setConversations([]); setTeachers([]); setStudents([]); setPaymentClaims([]); setChats([]); return; }
    const profile = await client.from("profiles").select("id,public_uid,display_name,avatar_url,role,display_title,nameplate_style").eq("id", user.id).maybeSingle();
    setActor((profile.data as PublicProfile | null) ?? null);
    if (!friendships.error) setConnections((friendships.data ?? []) as FriendshipConnection[]);
    if (!modern.error) {
      const rows = ((modern.data ?? []) as DirectConversation[]).map((item) => ({ ...item, unread_count: Number(item.unread_count || 0) }));
      setConversations(rows);
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as { userId?: string; chats?: Array<{ conversation_id: string; minimized?: boolean; maximized?: boolean; pinned?: boolean }> } | null;
        const restored = (stored?.userId === user.id ? stored.chats ?? [] : []).flatMap((saved, index) => { const value = rows.find((item) => item.conversation_id === saved.conversation_id); return value ? [{ ...value, minimized: saved.minimized, maximized: saved.maximized, pinned: saved.pinned, z: 51 + index }] : []; });
        if (restored.length) setChats((current) => current.length ? current : restored);
      } catch { /* Ignore malformed local window state. */ }
    }
    if (!mentorAccess.error) setTeachers((mentorAccess.data ?? []) as MentorAccess[]);
    if (!mentorStudents.error) setStudents((mentorStudents.data ?? []) as MentorStudent[]);
    if (!claims.error) setPaymentClaims((claims.data ?? []) as MentorPaymentClaim[]);
  }

  useEffect(() => {
    const client = createClient();
    const initial = window.setTimeout(() => void load(), 0);
    const auth = client.auth.onAuthStateChange(() => queueMicrotask(() => void load()));
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 9000);
    const customOpen = (event: Event) => { const detail = (event as CustomEvent<{ conversation?: DirectConversation }>).detail; if (detail?.conversation) openChat(detail.conversation); };
    window.addEventListener("wavekb:open-chat", customOpen);
    return () => { window.clearTimeout(initial); auth.data.subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener("wavekb:open-chat", customOpen); };
  }, []);

  useEffect(() => { if (actor) localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: actor.id, panel, chats: chats.map((item) => ({ conversation_id: item.conversation_id, minimized: item.minimized, maximized: item.maximized, pinned: item.pinned })) })); }, [actor, panel, chats]);
  useEffect(() => {
    const clampToViewport = () => {
      const box = panelRef.current?.getBoundingClientRect();
      setPanel((value) => {
        const next = clampPanelCoordinates(value, { width: window.innerWidth, height: window.innerHeight }, { width: box?.width || 304, height: box?.height || (value.minimized ? 48 : 520) });
        return next.x === value.x && next.y === value.y ? value : { ...value, ...next };
      });
    };
    window.addEventListener("resize", clampToViewport);
    window.addEventListener("orientationchange", clampToViewport);
    return () => { window.removeEventListener("resize", clampToViewport); window.removeEventListener("orientationchange", clampToViewport); };
  }, []);
  useEffect(() => {
    if (!actor) return;
    const client = createClient();
    const channel = client.channel("wavekb-member-presence", { config: { presence: { key: actor.id } } });
    channel.on("presence", { event: "sync" }, () => { const values = new Set<string>(); Object.entries(channel.presenceState()).forEach(([key, entries]) => { values.add(key); entries.forEach((entry) => { const id = (entry as { user_id?: string }).user_id; if (id) values.add(id); }); }); setOnline(values); }).subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({ user_id: actor.id, online_at: new Date().toISOString() }); });
    return () => { void channel.untrack(); void client.removeChannel(channel); };
  }, [actor]);

  function openChat(conversation: DirectConversation) {
    z.current += 1;
    setChats((current) => current.some((item) => item.conversation_id === conversation.conversation_id) ? current.map((item) => item.conversation_id === conversation.conversation_id ? { ...item, minimized: false, z: z.current } : item) : [...current, { ...conversation, z: z.current }]);
  }
  async function chatWith(item: FriendshipConnection) { const result = await createClient().rpc("open_direct_conversation", { p_target: item.other_id }); if (result.error) { setMessage(errorText(result.error)); return; } const existing = conversations.find((value) => value.conversation_id === String(result.data)); openChat(existing ?? { conversation_id: String(result.data), other_id: item.other_id, public_uid: item.public_uid ?? null, display_name: item.display_name || `UID ${item.public_uid || ""}`, avatar_url: item.avatar_url ?? null, display_title: item.display_title || "", nameplate_style: item.nameplate_style || "classic", last_message: null, last_message_at: null, unread_count: 0 }); }
  async function search(event: FormEvent) { event.preventDefault(); setMessage(""); if (!/^\d{5,6}$/.test(query)) { setMessage("请输入 5 至 6 位 UID。"); return; } const result = await createClient().rpc("search_profile_by_uid", { p_uid: Number(query) }); if (result.error) { setMessage(errorText(result.error)); return; } setSearchResult(((Array.isArray(result.data) ? result.data[0] : result.data) as MemberProfile | null) ?? null); }
  async function request(profile: MemberProfile) { const result = await createClient().rpc("send_friend_request", { p_target: profile.id }); if (result.error) setMessage(errorText(result.error)); else { tone(700, sound); setMessage("好友请求已发送。"); await load(); } }
  async function respond(item: FriendshipConnection, accept: boolean) { const result = await createClient().rpc("respond_friend_request", { p_friendship: item.friendship_id, p_accept: accept }); if (result.error) setMessage(errorText(result.error)); else { tone(accept ? 760 : 420, sound); await load(); } }
  function panelPointerDown(event: ReactPointerEvent) { if ((event.target as HTMLElement).closest("button,a,input")) return; const element = panelRef.current; if (!element) return; const box = element.getBoundingClientRect(); element.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top }; }
  function panelPointerMove(event: ReactPointerEvent) { const state = drag.current; const element = panelRef.current; if (!state || !element || state.id !== event.pointerId) return; const next = { x: Math.max(0, Math.min(window.innerWidth - 42, state.left + event.clientX - state.x)), y: Math.max(64, Math.min(window.innerHeight - 42, state.top + event.clientY - state.y)) }; element.style.left = `${next.x}px`; element.style.top = `${next.y}px`; }
  function panelPointerUp() { const element = panelRef.current; if (!drag.current || !element) return; drag.current = null; const box = element.getBoundingClientRect(); const distances = { left: box.left, right: innerWidth - box.right, top: box.top - 64, bottom: innerHeight - box.bottom }; const edge = (Object.entries(distances).sort((a,b) => a[1] - b[1])[0]?.[0] || "right") as PanelState["edge"]; const x = edge === "left" ? 8 : edge === "right" ? Math.max(8, innerWidth - box.width - 8) : Math.max(8, Math.min(innerWidth - box.width - 8, box.left)); const y = edge === "top" ? 70 : edge === "bottom" ? Math.max(70, innerHeight - box.height - 8) : Math.max(70, Math.min(innerHeight - box.height - 8, box.top)); setPanel((value) => ({ ...value, x, y, edge })); }

  if (!actor) return null;
  const friends = connections.filter((item) => item.status === "accepted");
  const requests = connections.filter((item) => item.status === "pending");
  const unread = conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
  const contactNeedle = contactQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleFriends = contactNeedle ? friends.filter((item) => [item.display_name, item.public_uid, item.bio].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(contactNeedle))) : friends;
  const unreadConversations = conversations.filter((item) => Number(item.unread_count || 0) > 0);
  const submittedClaims = paymentClaims.filter((item) => item.status === "submitted");
  const notificationTotal = unread + submittedClaims.length;
  return <>
    {!panel.open ? <button type="button" className={styles.launcher} onClick={() => setPanel((value) => ({ ...value, open: true }))} aria-label={`打开好友面板${notificationTotal ? `，${notificationTotal}条待处理通知` : ""}`}><UsersThree />{notificationTotal ? <span>{notificationTotal > 99 ? "99+" : notificationTotal}</span> : null}</button> : null}
    {panel.open ? <section ref={panelRef} className={styles.friendPanel} aria-label="好友与聊天" data-minimized={panel.minimized || undefined} data-autohidden={autoHidden || undefined} data-edge={panel.edge} style={{ left: panel.x, top: panel.y }} onMouseEnter={() => setAutoHidden(false)} onMouseLeave={() => { if (!panel.pinned && !drag.current) setAutoHidden(true); }}>
      <header className={styles.panelTitle} onPointerDown={panelPointerDown} onPointerMove={panelPointerMove} onPointerUp={panelPointerUp}>
        <AvatarFrame profile={actor} size="small" /><div className={styles.titleCopy}><IdentityName profile={actor} as="strong" /><span>{online.has(actor.id) ? "在线" : "已连接"}</span></div>
        <div className={styles.windowControls}><button type="button" onClick={() => { const next = !sound; setSound(next); localStorage.setItem(SOUND_KEY, next ? "on" : "off"); }} aria-label={sound ? "关闭提示音" : "开启提示音"}>{sound ? <SpeakerHigh /> : <SpeakerSlash />}</button><button type="button" onClick={() => setPanel((value) => ({ ...value, pinned: !value.pinned }))} aria-label={panel.pinned ? "取消固定" : "固定"}>{panel.pinned ? <PushPin /> : <PushPinSlash />}</button><button type="button" onClick={() => setPanel((value) => ({ ...value, minimized: !value.minimized }))} aria-label="最小化"><Minus /></button><button type="button" onClick={() => setPanel((value) => ({ ...value, open: false }))} aria-label="关闭"><X /></button></div>
      </header>
      {!panel.minimized ? <><nav className={styles.panelTabs} aria-label="好友面板"><button type="button" data-active={tab === "friends" || undefined} onClick={() => setTab("friends")}><UsersThree />好友</button><button type="button" data-active={tab === "new" || undefined} onClick={() => setTab("new")}><UserPlus />新朋友{requests.length ? <b>{requests.length}</b> : null}</button><button type="button" data-active={tab === "notifications" || undefined} onClick={() => setTab("notifications")}><Bell />消息{notificationTotal ? <b>{notificationTotal}</b> : null}</button></nav>
      <div className={styles.panelBody}>{tab === "friends" ? <>
        <label className={styles.contactSearch}><MagnifyingGlass aria-hidden /><span className="sr-only">搜索好友或 UID</span><input type="search" value={contactQuery} onChange={(event) => setContactQuery(event.target.value.slice(0, 80))} placeholder="搜索好友或 UID" aria-label="搜索好友或 UID" /></label>
        <div className={styles.groupHeading}><span>我的好友</span><span>{friends.filter((item) => online.has(item.other_id)).length}/{friends.length}</span></div>
        <div className={styles.rows}>{visibleFriends.length ? visibleFriends.map((item) => <div key={item.friendship_id} className={styles.friendRow} onDoubleClick={() => void chatWith(item)}><span className={styles.presence} data-online={online.has(item.other_id) || undefined} /><Link href={item.public_uid ? `/member/${item.public_uid}` : "/friends"}><AvatarFrame profile={{ display_name: item.display_name || "好友", avatar_url: item.avatar_url ?? null, nameplate_style: item.nameplate_style }} size="small" /></Link><div><Link href={item.public_uid ? `/member/${item.public_uid}` : "/friends"}><IdentityName profile={{ display_name: item.display_name || `UID ${item.public_uid || ""}`, nameplate_style: item.nameplate_style }} as="strong" /></Link><span>{item.bio || (online.has(item.other_id) ? "在线" : "离线")}</span></div><button type="button" onClick={() => void chatWith(item)} aria-label={`与${item.display_name || "好友"}聊天`}><ChatCircleDots /></button></div>) : <p className={styles.empty}>{friends.length ? "没有匹配的好友。" : "还没有好友。"}</p>}</div>
        {teachers.length ? <><div className={styles.groupHeading}><span>我的老师</span><span>{teachers.length}</span></div><div className={styles.rows}>{teachers.map((item) => <Link key={item.thread_id} href={`/tutoring/${item.thread_id}`} className={styles.mentorRow}><AvatarFrame profile={{ display_name: item.mentor_name, avatar_url: item.mentor_avatar_url, nameplate_style: "classic" }} size="small" /><span><strong>{item.mentor_name}</strong><small>{item.status === "active" ? "辅导进行中" : "辅导权益已结束"}</small></span><ChatCircleDots /></Link>)}</div></> : null}
        {students.length ? <><div className={styles.groupHeading}><span>我的学生</span><span>{students.length}</span></div><div className={styles.rows}>{students.map((item) => <Link key={item.thread_id} href={`/tutoring/${item.thread_id}`} className={styles.mentorRow}><AvatarFrame profile={{ display_name: item.display_name, avatar_url: item.avatar_url, nameplate_style: item.nameplate_style }} size="small" /><span><IdentityName profile={item} as="strong" /><small>{item.last_message || "打开辅导会话"}</small></span><ChatCircleDots /></Link>)}</div></> : null}
        <button className={styles.recentHeading} type="button" aria-expanded={recentOpen} onClick={() => setRecentOpen((value) => !value)}><span>最近会话</span><span>{conversations.length}</span></button>{recentOpen ? <div className={styles.rows}>{conversations.map((item) => <button type="button" className={styles.conversationRow} key={item.conversation_id} onClick={() => openChat(item)}><AvatarFrame profile={item} size="small" /><span><strong>{item.display_name}</strong><small>{item.last_message || "还没有消息"}</small></span><time>{formatTime(item.last_message_at)}</time>{Number(item.unread_count || 0) ? <b>{item.unread_count}</b> : null}</button>)}</div> : null}
      </> : tab === "new" ? <><form className={styles.friendSearch} onSubmit={search}><input aria-label="搜索好友 UID" inputMode="numeric" placeholder="输入 5–6 位 UID" value={query} onChange={(event) => setQuery(event.target.value.replace(/\D/g, "").slice(0,6))} /><button type="submit" aria-label="搜索"><MagnifyingGlass /></button></form>{searchResult && searchResult.id !== actor.id ? <div className={styles.searchResult}><AvatarFrame profile={searchResult} size="small" /><span><IdentityName profile={searchResult} as="strong" /><Nameplate uid={searchResult.public_uid} style={searchResult.nameplate_style} compact /></span><button type="button" onClick={() => void request(searchResult)}><UserPlus />添加</button></div> : null}<div className={styles.rows}>{requests.length ? requests.map((item) => <div key={item.friendship_id} className={styles.requestRow}><AvatarFrame profile={{ display_name: item.display_name || "用户", avatar_url: item.avatar_url ?? null, nameplate_style: item.nameplate_style }} size="small" /><span><strong>{item.display_name}</strong><small>{item.direction === "incoming" ? "请求添加你为好友" : "等待对方接受"}</small></span>{item.direction === "incoming" ? <div><button type="button" onClick={() => void respond(item,true)} aria-label="接受"><Check /></button><button type="button" onClick={() => void respond(item,false)} aria-label="拒绝"><X /></button></div> : null}</div>) : <p className={styles.empty}>没有待处理请求。</p>}</div></> : <div className={styles.rows}>{unreadConversations.map((item) => <button type="button" className={styles.notificationRow} key={item.conversation_id} onClick={() => openChat(item)}><Bell /><span><strong>{item.display_name} 发来新消息</strong><small>{item.last_message}</small></span><b>{item.unread_count}</b></button>)}{submittedClaims.map((claim) => <Link href="/mentor/manage" className={styles.notificationRow} key={claim.claim_id}><Bell /><span><strong>{claim.display_name || "用户"} 已提交付款确认</strong><small>{claim.offer_name || "辅导服务"} · {formatMentorPrice(claim.amount_cents, claim.currency)}</small></span><b>待核对</b></Link>)}{notificationTotal ? null : <p className={styles.empty}>暂无新消息通知。</p>}</div>}{message ? <p className={styles.error} role="status">{message}</p> : null}</div></> : null}
    </section> : null}
    {chats.map((chat) => <FloatingChat key={chat.conversation_id} actorId={actor.id} chat={chat} sound={sound} onClose={() => setChats((current) => current.filter((item) => item.conversation_id !== chat.conversation_id))} onFocus={() => { z.current += 1; setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, z: z.current } : item)); }} onPatch={(value) => setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, ...value } : item))} onRead={() => { setConversations((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, unread_count: 0 } : item)); setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, unread_count: 0 } : item)); }} />)}
  </>;
}
