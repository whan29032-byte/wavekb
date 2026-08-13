"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { Check, ImageSquare, UploadSimple } from "@phosphor-icons/react";
import type { EditableMemberProfile } from "@wavekb/domain";
import { splitProfileTags, validateMemberProfile, validateProfileImage } from "@wavekb/domain";
import { Button, Field, FieldMessage, Input, Label, Textarea } from "@wavekb/ui";
import type { NameplateEntitlement } from "@/lib/member/server-repository";
import { createClient } from "@/lib/supabase/client";
import { legacySiteUrl, publicSupabaseConfig } from "@/lib/env";
import { cropAvatarFile, profileImagePathFromPublicUrl } from "@/lib/member/profile-images";

type ProfileErrors = Partial<Record<"displayName" | "bio" | "markets" | "timeframes" | "coverStyle" | "avatar" | "cover" | "form", string>>;

const coverOptions = [
  { value: "chart-dark", label: "深色行情图", className: "bg-slate-800" },
  { value: "wave-blue", label: "波浪蓝", className: "bg-blue-800" },
  { value: "paper", label: "研究纸张", className: "bg-stone-300" },
  { value: "midnight", label: "午夜紫", className: "bg-indigo-950" },
] as const;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/auth|jwt|permission|row-level/i.test(message)) return "登录状态已失效，请重新登录。";
  if (/storage|upload|fetch|network/i.test(message)) return "图片上传没有完成，请检查网络后重试。";
  return message || "资料没有保存，请稍后重试。";
}

export function ProfileEditor({ profile, initialNameplates }: { profile: EditableMemberProfile; initialNameplates: NameplateEntitlement[] }) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio || "");
  const [markets, setMarkets] = useState(profile.markets.join("、"));
  const [timeframes, setTimeframes] = useState(profile.timeframes.join("、"));
  const [coverStyle, setCoverStyle] = useState(profile.cover_style || "chart-dark");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar_url || "");
  const [coverPreview, setCoverPreview] = useState(profile.cover_url || "");
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [nameplates, setNameplates] = useState(initialNameplates);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [equipping, setEquipping] = useState<string | null>(null);
  const avatarObjectUrl = useRef("");
  const coverObjectUrl = useRef("");
  const persistedAvatarUrl = useRef(profile.avatar_url);
  const persistedCoverUrl = useRef(profile.cover_url);

  useEffect(() => () => {
    if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
    if (coverObjectUrl.current) URL.revokeObjectURL(coverObjectUrl.current);
  }, []);

  function selectImage(event: ChangeEvent<HTMLInputElement>, kind: "avatar" | "cover") {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    const error = validateProfileImage(file, kind === "avatar" ? "头像" : "背景图");
    if (error) {
      setErrors((current) => ({ ...current, [kind]: error }));
      return;
    }
    const objectRef = kind === "avatar" ? avatarObjectUrl : coverObjectUrl;
    if (objectRef.current) URL.revokeObjectURL(objectRef.current);
    objectRef.current = URL.createObjectURL(file);
    setErrors((current) => ({ ...current, [kind]: undefined }));
    if (kind === "avatar") {
      setAvatarFile(file);
      setAvatarPreview(objectRef.current);
    } else {
      setCoverFile(file);
      setCoverPreview(objectRef.current);
      setCoverRemoved(false);
    }
  }

  function removeCover() {
    if (coverObjectUrl.current) URL.revokeObjectURL(coverObjectUrl.current);
    coverObjectUrl.current = "";
    setCoverFile(null);
    setCoverPreview("");
    setCoverRemoved(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateMemberProfile({
      displayName,
      bio,
      markets: splitProfileTags(markets),
      timeframes: splitProfileTags(timeframes),
      coverStyle,
    });
    const avatarError = avatarFile ? validateProfileImage(avatarFile, "头像") : null;
    const coverError = coverFile ? validateProfileImage(coverFile, "背景图") : null;
    if (!validation.ok || avatarError || coverError) {
      setErrors({ ...validation.fields, avatar: avatarError || undefined, cover: coverError || undefined });
      return;
    }

    setPending(true);
    setErrors({});
    setStatus("正在处理资料。");
    const client = createClient();
    const uploadedPaths: string[] = [];
    let nextAvatarUrl = persistedAvatarUrl.current;
    let nextCoverUrl = coverRemoved ? null : persistedCoverUrl.current;
    try {
      const timestamp = Date.now();
      if (avatarFile) {
        setStatus("正在裁切并上传头像。");
        const cropped = await cropAvatarFile(avatarFile);
        const path = `${profile.id}/avatar-${timestamp}.webp`;
        const upload = await client.storage.from("profile-avatars").upload(path, cropped, { contentType: "image/webp", upsert: false });
        if (upload.error) throw upload.error;
        uploadedPaths.push(path);
        nextAvatarUrl = client.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
      }
      if (coverFile) {
        setStatus("正在上传个人页背景。");
        const extension = coverFile.type === "image/jpeg" ? "jpg" : coverFile.type === "image/png" ? "png" : "webp";
        const path = `${profile.id}/cover-${timestamp}.${extension}`;
        const upload = await client.storage.from("profile-avatars").upload(path, coverFile, { contentType: coverFile.type, upsert: false });
        if (upload.error) throw upload.error;
        uploadedPaths.push(path);
        nextCoverUrl = client.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
      }

      setStatus("正在同步个人名片。");
      const result = await client.rpc("update_my_profile_v2", {
        new_display_name: validation.value.displayName,
        new_bio: validation.value.bio,
        new_markets: validation.value.markets,
        new_timeframes: validation.value.timeframes,
        new_avatar_url: nextAvatarUrl || null,
        new_cover_url: nextCoverUrl || null,
        new_cover_style: validation.value.coverStyle,
      });
      if (result.error) throw result.error;

      const config = publicSupabaseConfig();
      const oldPaths = [
        avatarFile ? profileImagePathFromPublicUrl(persistedAvatarUrl.current, config.url, profile.id) : null,
        (coverRemoved || coverFile) ? profileImagePathFromPublicUrl(persistedCoverUrl.current, config.url, profile.id) : null,
      ].filter((path): path is string => Boolean(path) && !uploadedPaths.includes(path as string));
      if (oldPaths.length) await client.storage.from("profile-avatars").remove(oldPaths).catch(() => undefined);

      persistedAvatarUrl.current = nextAvatarUrl;
      persistedCoverUrl.current = nextCoverUrl;
      setAvatarFile(null);
      setCoverFile(null);
      setCoverRemoved(false);
      setAvatarPreview(nextAvatarUrl || "");
      setCoverPreview(nextCoverUrl || "");
      setStatus("资料已保存。");
    } catch (error) {
      if (uploadedPaths.length) await client.storage.from("profile-avatars").remove(uploadedPaths).catch(() => undefined);
      setErrors({ form: friendlyError(error) });
      setStatus("");
    } finally {
      setPending(false);
    }
  }

  async function equipNameplate(item: NameplateEntitlement) {
    setEquipping(item.id);
    setStatus("");
    try {
      const result = await createClient().rpc("equip_my_nameplate", { p_entitlement: item.id });
      if (result.error) throw result.error;
      setNameplates((current) => current.map((entry) => ({ ...entry, equipped: entry.id === item.id })));
      setStatus("身份铭牌已同步。");
    } catch (error) {
      setErrors((current) => ({ ...current, form: friendlyError(error) }));
    } finally {
      setEquipping(null);
    }
  }

  const previewCoverClass = coverOptions.find((item) => item.value === coverStyle)?.className || "bg-slate-800";
  const previewInitial = (displayName.trim() || "研").slice(0, 1);

  return (
    <form className="grid gap-8" onSubmit={submit}>
      <section className="overflow-hidden rounded-xl border bg-surface" aria-label="个人名片实时预览">
        <div className={`relative h-36 overflow-hidden md:h-44 ${previewCoverClass}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {coverPreview ? <img src={coverPreview} alt="个人页背景预览" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="flex items-start gap-4 p-5 md:p-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatarPreview ? <img src={avatarPreview} alt="头像预览" className="-mt-16 size-24 shrink-0 rounded-xl border-4 border-surface bg-muted object-cover md:size-28" /> : <div className="-mt-16 grid size-24 shrink-0 place-items-center rounded-xl border-4 border-surface bg-muted text-3xl font-semibold md:size-28">{previewInitial}</div>}
          <div className="grid min-w-0 gap-1"><p className="text-xs font-semibold text-primary">{profile.display_title || "波浪研究者"}</p><h2 className="truncate text-2xl font-semibold">{displayName.trim() || "波浪研究者"}</h2><p className="text-sm text-muted-foreground">UID {profile.public_uid || "未设置"}</p><p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">{bio.trim() || "写一句属于你的研究签名。"}</p></div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="grid content-start gap-5 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="profile-identity-title">
          <header className="grid gap-1"><h2 id="profile-identity-title" className="text-xl font-semibold">身份与研究偏好</h2><p className="text-sm text-muted-foreground">资料会同步到公开主页、好友列表和私聊。</p></header>
          <Field><Label htmlFor="profile-display-name">昵称</Label><Input id="profile-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={32} autoComplete="nickname" aria-invalid={Boolean(errors.displayName)} />{errors.displayName ? <FieldMessage>{errors.displayName}</FieldMessage> : <p className="text-xs text-muted-foreground">2-32 个字符。</p>}</Field>
          <Field><div className="flex justify-between gap-3"><Label htmlFor="profile-bio">个性签名</Label><span className="text-xs tabular-nums text-muted-foreground">{bio.length}/200</span></div><Textarea id="profile-bio" value={bio} onChange={(event) => setBio(event.target.value)} rows={4} maxLength={200} placeholder="说明你的研究原则或关注方向" aria-invalid={Boolean(errors.bio)} />{errors.bio ? <FieldMessage>{errors.bio}</FieldMessage> : null}</Field>
          <Field><Label htmlFor="profile-markets">关注市场</Label><Input id="profile-markets" value={markets} onChange={(event) => setMarkets(event.target.value)} placeholder="加密、贵金属、股指" aria-invalid={Boolean(errors.markets)} /><p className="text-xs text-muted-foreground">使用顿号或逗号分隔，最多 8 个。</p>{errors.markets ? <FieldMessage>{errors.markets}</FieldMessage> : null}</Field>
          <Field><Label htmlFor="profile-timeframes">常用周期</Label><Input id="profile-timeframes" value={timeframes} onChange={(event) => setTimeframes(event.target.value)} placeholder="日线、4小时、15分钟" aria-invalid={Boolean(errors.timeframes)} /><p className="text-xs text-muted-foreground">使用顿号或逗号分隔，最多 8 个。</p>{errors.timeframes ? <FieldMessage>{errors.timeframes}</FieldMessage> : null}</Field>
        </section>

        <section className="grid content-start gap-5 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="profile-appearance-title">
          <header className="grid gap-1"><h2 id="profile-appearance-title" className="text-xl font-semibold">头像与背景</h2><p className="text-sm text-muted-foreground">头像自动居中裁切为 512 像素 WebP，原图不会上传。</p></header>
          <Field><Label htmlFor="profile-avatar">头像</Label><label htmlFor="profile-avatar" className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-muted px-4 text-sm font-medium hover:border-primary/45"><UploadSimple aria-hidden size={19} />选择头像</label><input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => selectImage(event, "avatar")} /><p className="text-xs text-muted-foreground">JPG、PNG、WebP，最大 5 MiB。</p>{errors.avatar ? <FieldMessage>{errors.avatar}</FieldMessage> : null}</Field>
          <Field><Label htmlFor="profile-cover">个人页背景</Label><label htmlFor="profile-cover" className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-muted px-4 text-sm font-medium hover:border-primary/45"><ImageSquare aria-hidden size={19} />选择横向图片</label><input id="profile-cover" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => selectImage(event, "cover")} /><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">JPG、PNG、WebP，最大 5 MiB。</p>{coverPreview ? <Button type="button" variant="ghost" size="small" onClick={removeCover}>移除背景</Button> : null}</div>{errors.cover ? <FieldMessage>{errors.cover}</FieldMessage> : null}</Field>
          <fieldset className="grid gap-2"><legend className="text-sm font-semibold">背景色调</legend><div className="grid grid-cols-2 gap-2">{coverOptions.map((option) => <button key={option.value} type="button" aria-pressed={coverStyle === option.value} onClick={() => setCoverStyle(option.value)} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm font-medium ${coverStyle === option.value ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/45"}`}><span aria-hidden className={`size-6 rounded-md ${option.className}`} />{option.label}{coverStyle === option.value ? <Check aria-hidden size={17} className="ml-auto text-primary" /> : null}</button>)}</div>{errors.coverStyle ? <FieldMessage>{errors.coverStyle}</FieldMessage> : null}</fieldset>
        </section>
      </div>

      <section className="grid gap-4 rounded-xl border bg-surface p-5 md:p-6" aria-labelledby="profile-nameplate-title">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="profile-nameplate-title" className="text-xl font-semibold">身份铭牌</h2><p className="mt-1 text-sm text-muted-foreground">佩戴后同步更新昵称、头像框、好友列表和私聊。</p></div><Button asChild variant="secondary"><a href={`${legacySiteUrl()}/#space=rewards`}>前往积分商城</a></Button></header>
        {nameplates.length ? <div className="grid gap-3 sm:grid-cols-2">{nameplates.map((item) => <article key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-muted p-4"><div className="min-w-0"><strong className="block truncate text-sm">{item.product_name}</strong><span className="text-xs text-muted-foreground">有效至 {new Date(item.expires_at).toLocaleDateString("zh-CN")}</span></div><Button type="button" variant={item.equipped ? "secondary" : "primary"} size="small" disabled={item.equipped || equipping !== null} onClick={() => equipNameplate(item)}>{item.equipped ? "当前佩戴" : equipping === item.id ? "正在切换" : "佩戴"}</Button></article>)}</div> : <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">目前没有可佩戴的身份铭牌，可以前往积分商城兑换。</div>}
      </section>

      <footer className="flex flex-col gap-3 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"><div className="grid gap-1">{errors.form ? <FieldMessage role="alert">{errors.form}</FieldMessage> : null}{status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : <p className="text-xs text-muted-foreground">保存后所有会员页面会读取同一份资料。</p>}</div><div className="flex gap-2"><Button asChild variant="secondary"><Link href={`/member/${profile.public_uid}`}>取消</Link></Button><Button type="submit" disabled={pending}>{pending ? "正在保存" : "保存资料"}</Button></div></footer>
    </form>
  );
}
