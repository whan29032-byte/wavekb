begin;

-- 1. YouTube 同步内容独立到“视频分享”，不再混入思路/行情讨论板块。
do $$
declare
  constraint_row record;
  has_unknown boolean;
begin
  select exists (
    select 1
    from public.posts
    where board is not null
      and board not in (
        'public_viewpoint', 'idea_sharing', 'case_submission',
        'question_answers', 'review_answers', 'video_sharing'
      )
  ) into has_unknown;

  if has_unknown then
    raise exception 'posts_board_unknown';
  end if;

  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.posts'::regclass
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%board%'
  loop
    execute format('alter table public.posts drop constraint if exists %I', constraint_row.conname);
  end loop;

  alter table public.posts
    add constraint posts_board_allowed_check
    check (board is null or board in (
      'public_viewpoint', 'idea_sharing', 'case_submission',
      'question_answers', 'review_answers', 'video_sharing'
    ));
end;
$$;

update public.posts post
set board = 'video_sharing'
where post.board = 'idea_sharing'
  and exists (
    select 1 from public.youtube_post_sources source where source.post_id = post.id
  );

create or replace function public.youtube_commit_page(p_connection_id uuid,p_worker_id text,p_expected_cursor text,p_next_cursor text,p_videos jsonb,p_history_complete boolean,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections; v_owner uuid; v jsonb; k text; source public.youtube_post_sources; p_id uuid; v_title text; v_body text; v_count integer:=0;
begin
  select owner_id into v_owner from public.youtube_connections where id=p_connection_id;
  -- Same profile→connection lock ordering as owner settings/OAuth avoids a
  -- moderation or reauthorization race producing a needless deadlock.
  perform public._youtube_require_owner(v_owner);
  c:=public._youtube_lock_lease(p_connection_id,p_worker_id);
  if p_mode is null or p_mode not in('history','poll') or jsonb_typeof(p_videos) is distinct from 'array' or jsonb_array_length(p_videos)>50 then raise exception 'youtube_page_invalid'; end if;
  if p_mode='history' and (c.history_complete or c.history_cursor is distinct from p_expected_cursor) then raise exception 'youtube_cursor_conflict'; end if;
  if p_mode='poll' and not c.sync_enabled then raise exception 'youtube_sync_disabled'; end if;
  if p_mode='poll' and c.poll_cursor is distinct from p_expected_cursor then raise exception 'youtube_cursor_conflict'; end if;
  for v in select value from jsonb_array_elements(p_videos) loop
    if v->>'channelId' is distinct from c.channel_id then raise exception 'youtube_channel_mismatch'; end if;
    if coalesce(v->>'privacyStatus','')<>'public' then continue; end if;
    if p_mode='poll' and (nullif(v->>'publishedAt','') is null or (v->>'publishedAt')::timestamptz<c.sync_since) then continue; end if;
    if v->>'id' !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'youtube_video_invalid'; end if;
    k:=encode(sha256(convert_to(c.source_salt||c.channel_id||':'||(v->>'id'),'utf8')),'hex');
    select * into source from public.youtube_post_sources where source_key=k for update;
    if found then continue; end if;
    v_title:=left(trim(coalesce(v->>'title','')),120);
    if char_length(v_title)<5 then v_title:=left('YouTube 视频：'||v_title,120); end if;
    v_body:=left(trim(coalesce(v->>'description','')),19000)||E'\n\n本帖由作者授权同步自 YouTube。原视频：https://www.youtube.com/watch?v='||(v->>'id');
    insert into public.posts(board,title,body,author_id,status,external_url,external_kind)
    values('video_sharing',v_title,v_body,c.owner_id,'draft','https://www.youtube.com/watch?v='||(v->>'id'),'youtube') returning id into p_id;
    insert into public.post_external_references(post_id,owner_id,url,kind,sort_order)
    values(p_id,c.owner_id,'https://www.youtube.com/watch?v='||(v->>'id'),'youtube',0);
    insert into public.youtube_post_sources(connection_id,source_key,video_id,post_id,generated_title,generated_body)
    values(c.id,k,v->>'id',p_id,v_title,v_body);
    update public.posts set status='published' where id=p_id;
    v_count:=v_count+1;
  end loop;
  update public.youtube_connections set history_cursor=case when p_mode='history' then p_next_cursor else history_cursor end,
    poll_cursor=case when p_mode='poll' then p_next_cursor else poll_cursor end,
    history_complete=case when p_mode='history' then p_history_complete else history_complete end,
    history_imported=history_imported+case when p_mode='history' then v_count else 0 end,
    last_synced_at=now(),last_error_code=null,lease_until=now()+interval '3 minutes' where id=c.id;
  return jsonb_build_object('imported',v_count);
end; $$;

-- 2. 互动展示与点赞积分配置。虚拟浏览/点赞只影响展示，不写入积分账本。
create table if not exists public.community_engagement_settings (
  id boolean primary key default true check (id),
  virtual_enabled boolean not null default true,
  like_points integer not null default 1 check (like_points between 0 and 100),
  like_daily_cap integer not null default 100 check (like_daily_cap between 1 and 10000),
  active_weight_threshold integer not null default 20 check (active_weight_threshold between 0 and 100000),
  inactive_view_min integer not null default 120 check (inactive_view_min >= 0),
  inactive_view_max integer not null default 220 check (inactive_view_max >= inactive_view_min),
  inactive_like_min integer not null default 2 check (inactive_like_min >= 0),
  inactive_like_max integer not null default 8 check (inactive_like_max >= inactive_like_min),
  active_view_min integer not null default 500 check (active_view_min >= 0),
  active_view_max integer not null default 1500 check (active_view_max >= active_view_min),
  active_like_min integer not null default 20 check (active_like_min >= 0),
  active_like_max integer not null default 80 check (active_like_max >= active_like_min),
  updated_at timestamptz not null default now()
);

insert into public.community_engagement_settings(id) values (true)
on conflict (id) do nothing;

alter table public.community_engagement_settings enable row level security;
revoke all on table public.community_engagement_settings from anon, authenticated;

-- 3. 真实点赞与浏览。浏览使用客户端 visitor key 去重，不保存 IP。
create table if not exists public.post_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_likes_post_idx on public.post_likes(post_id);
create index if not exists posts_author_published_idx
  on public.posts(author_id) where status = 'published';
create index if not exists post_comments_author_visible_idx
  on public.post_comments(author_id) where status = 'visible';

alter table public.post_likes enable row level security;

drop policy if exists "likers read own likes" on public.post_likes;
create policy "likers read own likes"
on public.post_likes for select to authenticated
using (user_id = auth.uid());

drop policy if exists "verified users like published posts" on public.post_likes;
create policy "verified users like published posts"
on public.post_likes for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_verified_user()
  and exists (
    select 1 from public.posts
    where posts.id = post_id
      and posts.status = 'published'
      and posts.author_id <> auth.uid()
  )
);

drop policy if exists "users unlike own likes" on public.post_likes;
create policy "users unlike own likes"
on public.post_likes for delete to authenticated
using (user_id = auth.uid());

create table if not exists public.post_view_events (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer_key text not null check (char_length(viewer_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (post_id, viewer_key)
);

create index if not exists post_view_events_post_idx on public.post_view_events(post_id);
alter table public.post_view_events enable row level security;
revoke all on table public.post_view_events from anon, authenticated;

create or replace function public.record_post_view(p_post_id uuid, p_viewer_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_post_id is null then return; end if;
  v_key := left(trim(coalesce(p_viewer_key, '')), 100);
  if char_length(v_key) < 8 then return; end if;
  if auth.uid() is not null then
    v_key := 'user:' || auth.uid()::text;
  end if;
  if not exists (
    select 1 from public.posts where id = p_post_id and status = 'published'
  ) then
    return;
  end if;
  insert into public.post_view_events(post_id, viewer_key)
  values (p_post_id, v_key)
  on conflict (post_id, viewer_key) do nothing;
end;
$$;

revoke all on function public.record_post_view(uuid, text) from public;
grant execute on function public.record_post_view(uuid, text) to anon, authenticated;

-- 4. 真实点赞给作者加分；虚拟点赞永远不会进入这一触发器。
create or replace function public.reward_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_points integer;
  v_cap integer;
  v_awarded_today integer;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then return new; end if;

  select like_points, like_daily_cap
  into v_points, v_cap
  from public.community_engagement_settings where id;

  if coalesce(v_points, 0) <= 0 then return new; end if;

  select count(*) into v_awarded_today
  from public.reward_ledger
  where user_id = v_author
    and action_key = 'post_like_received'
    and created_at >= current_date;

  if v_awarded_today >= coalesce(v_cap, 100) then return new; end if;

  perform public.award_reward_points(
    v_author,
    'post_like_received',
    new.post_id::text || ':' || new.user_id::text,
    v_points,
    '帖子获得点赞'
  );
  return new;
end;
$$;

revoke all on function public.reward_post_like() from public;
drop trigger if exists reward_post_like_trigger on public.post_likes;
create trigger reward_post_like_trigger
after insert on public.post_likes
for each row execute function public.reward_post_like();

-- 5. 帖子展示计数：真实浏览/点赞 + 按作者权重生成的稳定虚拟值。
create or replace function public.post_engagement(p_post_ids uuid[])
returns table(post_id uuid, view_count bigint, like_count bigint, liked_by_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_post_ids is null or array_length(p_post_ids, 1) is null or array_length(p_post_ids, 1) > 100 then
    return;
  end if;

  return query
  with requested as (
    select distinct unnest(p_post_ids) as id
  ),
  real_counts as (
    select
      requested.id as post_id,
      posts.author_id,
      (select count(*) from public.post_view_events views where views.post_id = requested.id)::bigint as real_views,
      (select count(*) from public.post_likes likes where likes.post_id = requested.id)::bigint as real_likes
    from requested
    join public.posts posts on posts.id = requested.id
  ),
  author_stats as (
    select
      authors.author_id,
      (select count(*) from public.posts where posts.author_id = authors.author_id and posts.status = 'published')::integer as post_count,
      (select count(*) from public.post_comments where post_comments.author_id = authors.author_id and post_comments.status = 'visible')::integer as comment_count,
      (select count(*) from public.post_likes likes join public.posts on posts.id = likes.post_id where posts.author_id = authors.author_id)::integer as received_likes,
      (select count(*) from public.reward_daily_checkins where reward_daily_checkins.user_id = authors.author_id and reward_daily_checkins.checkin_date >= current_date - 30)::integer as checkin_count,
      (select greatest(0, (extract(epoch from now() - profiles.created_at) / 86400))::integer from public.profiles where profiles.id = authors.author_id) as age_days
    from (select distinct author_id from real_counts) authors
  ),
  scored as (
    select
      author_stats.author_id,
      (author_stats.post_count * 3 + author_stats.comment_count + author_stats.received_likes
        + author_stats.checkin_count + (coalesce(author_stats.age_days, 0) / 30)) as weight_score
    from author_stats
  ),
  params as (
    select
      real_counts.post_id,
      real_counts.author_id,
      real_counts.real_views,
      real_counts.real_likes,
      settings.virtual_enabled,
      case when coalesce(scored.weight_score, 0) >= settings.active_weight_threshold
        then settings.active_view_min else settings.inactive_view_min end as view_min,
      case when coalesce(scored.weight_score, 0) >= settings.active_weight_threshold
        then settings.active_view_max else settings.inactive_view_max end as view_max,
      case when coalesce(scored.weight_score, 0) >= settings.active_weight_threshold
        then settings.active_like_min else settings.inactive_like_min end as like_min,
      case when coalesce(scored.weight_score, 0) >= settings.active_weight_threshold
        then settings.active_like_max else settings.inactive_like_max end as like_max
    from real_counts
    left join scored on scored.author_id = real_counts.author_id
    cross join public.community_engagement_settings settings
    where settings.id
  ),
  offsets as (
    select
      params.*,
      (params.view_max - params.view_min + 1) as view_range,
      (params.like_max - params.like_min + 1) as like_range,
      hashtextextended(params.post_id::text || ':' || params.author_id::text, 0) as view_seed,
      hashtextextended(params.post_id::text || ':like:' || params.author_id::text, 0) as like_seed
    from params
  ),
  virtual_counts as (
    select
      offsets.post_id,
      offsets.real_views,
      offsets.real_likes,
      offsets.virtual_enabled,
      case when offsets.virtual_enabled then
        offsets.view_min + (((offsets.view_seed % greatest(1, offsets.view_range)) + greatest(1, offsets.view_range)) % greatest(1, offsets.view_range))
      else 0 end as virtual_views,
      case when offsets.virtual_enabled then
        offsets.like_min + (((offsets.like_seed % greatest(1, offsets.like_range)) + greatest(1, offsets.like_range)) % greatest(1, offsets.like_range))
      else 0 end as virtual_likes
    from offsets
  )
  select
    virtual_counts.post_id,
    virtual_counts.real_views + virtual_counts.virtual_views,
    virtual_counts.real_likes + virtual_counts.virtual_likes,
    coalesce(auth.uid() is not null and exists (
      select 1 from public.post_likes likes
      where likes.post_id = virtual_counts.post_id and likes.user_id = auth.uid()
    ), false)
  from virtual_counts;
end;
$$;

revoke all on function public.post_engagement(uuid[]) from public;
grant execute on function public.post_engagement(uuid[]) to anon, authenticated;

create or replace function public.admin_get_community_engagement_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  return (select to_jsonb(settings) from public.community_engagement_settings settings where settings.id);
end;
$$;

create or replace function public.admin_update_community_engagement_settings(
  p_virtual_enabled boolean,
  p_like_points integer,
  p_like_daily_cap integer,
  p_active_weight_threshold integer,
  p_inactive_view_min integer,
  p_inactive_view_max integer,
  p_inactive_like_min integer,
  p_inactive_like_max integer,
  p_active_view_min integer,
  p_active_view_max integer,
  p_active_like_min integer,
  p_active_like_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_virtual_enabled is null
    or p_like_points is null or p_like_points not between 0 and 100
    or p_like_daily_cap is null or p_like_daily_cap not between 1 and 10000
    or p_active_weight_threshold is null or p_active_weight_threshold not between 0 and 100000
    or p_inactive_view_min is null or p_inactive_view_min < 0
    or p_inactive_view_max is null or p_inactive_view_max < p_inactive_view_min
    or p_inactive_like_min is null or p_inactive_like_min < 0
    or p_inactive_like_max is null or p_inactive_like_max < p_inactive_like_min
    or p_active_view_min is null or p_active_view_min < 0
    or p_active_view_max is null or p_active_view_max < p_active_view_min
    or p_active_like_min is null or p_active_like_min < 0
    or p_active_like_max is null or p_active_like_max < p_active_like_min
    or greatest(p_inactive_view_max, p_active_view_max, p_inactive_like_max, p_active_like_max) > 1000000
  then
    raise exception 'engagement_settings_invalid';
  end if;

  update public.community_engagement_settings
  set virtual_enabled = p_virtual_enabled,
      like_points = p_like_points,
      like_daily_cap = p_like_daily_cap,
      active_weight_threshold = p_active_weight_threshold,
      inactive_view_min = p_inactive_view_min,
      inactive_view_max = p_inactive_view_max,
      inactive_like_min = p_inactive_like_min,
      inactive_like_max = p_inactive_like_max,
      active_view_min = p_active_view_min,
      active_view_max = p_active_view_max,
      active_like_min = p_active_like_min,
      active_like_max = p_active_like_max,
      updated_at = now()
  where id;

  return (select to_jsonb(settings) from public.community_engagement_settings settings where settings.id);
end;
$$;

revoke all on function public.admin_get_community_engagement_settings() from public;
revoke all on function public.admin_update_community_engagement_settings(
  boolean, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer
) from public;
grant execute on function public.admin_get_community_engagement_settings() to authenticated;
grant execute on function public.admin_update_community_engagement_settings(
  boolean, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer
) to authenticated;

-- 6. 评论图片。
create table if not exists public.post_comment_images (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null check (sort_order between 0 and 3),
  created_at timestamptz not null default now(),
  unique (comment_id, sort_order)
);

create index if not exists post_comment_images_comment_idx
  on public.post_comment_images(comment_id, sort_order);

alter table public.post_comment_images enable row level security;

drop policy if exists "comment images are readable with visible comments" on public.post_comment_images;
create policy "comment images are readable with visible comments"
on public.post_comment_images for select
using (
  exists (
    select 1
    from public.post_comments comments
    join public.posts posts on posts.id = comments.post_id
    where comments.id = comment_id
      and comments.status = 'visible'
      and posts.status = 'published'
  )
);

drop policy if exists "comment authors add images" on public.post_comment_images;
create policy "comment authors add images"
on public.post_comment_images for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.post_comments comments
    where comments.id = comment_id
      and comments.author_id = auth.uid()
      and comments.status = 'visible'
  )
);

drop policy if exists "comment image owners delete" on public.post_comment_images;
create policy "comment image owners delete"
on public.post_comment_images for delete to authenticated
using (owner_id = auth.uid());

-- 7. 奖励商品/抽奖自定义图片桶。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reward-images',
  'reward-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "reward images are publicly readable" on storage.objects;
create policy "reward images are publicly readable"
on storage.objects for select
using (bucket_id = 'reward-images');

drop policy if exists "admins upload reward images" on storage.objects;
create policy "admins upload reward images"
on storage.objects for insert to authenticated
with check (bucket_id = 'reward-images' and public.mentor_is_admin());

drop policy if exists "admins update reward images" on storage.objects;
create policy "admins update reward images"
on storage.objects for update to authenticated
using (bucket_id = 'reward-images' and public.mentor_is_admin())
with check (bucket_id = 'reward-images' and public.mentor_is_admin());

drop policy if exists "admins delete reward images" on storage.objects;
create policy "admins delete reward images"
on storage.objects for delete to authenticated
using (bucket_id = 'reward-images' and public.mentor_is_admin());

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path='' as $$ select '202610190001'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
