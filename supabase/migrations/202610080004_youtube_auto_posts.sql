begin;

-- These tables have no browser policies or grants. All access is through the
-- authenticated gateway's service-only RPCs, never a Supabase OAuth identity merge.
create table public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  channel_id text unique,
  channel_key text not null,
  source_salt text not null default gen_random_uuid()::text||gen_random_uuid()::text,
  channel_title text not null default '',
  channel_refreshed_at timestamptz not null default now(),
  uploads_playlist_id text not null default '',
  status text not null default 'connected' check (status in ('connected','reconnect_required','revocation_pending')),
  sync_enabled boolean not null default false,
  import_history boolean not null default false,
  history_cursor text,
  poll_cursor text,
  history_complete boolean not null default true,
  history_imported integer not null default 0,
  last_synced_at timestamptz,
  sync_since timestamptz not null default now(),
  next_sync_at timestamptz not null default now(),
  last_error_code text,
  lease_worker_id text,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
create table public.youtube_connection_secrets (
  connection_id uuid primary key references public.youtube_connections(id) on delete cascade,
  ciphertext text not null, iv text not null, auth_tag text not null,
  key_version integer not null check (key_version = 1)
);
create table public.youtube_oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  verifier_secret jsonb not null,
  import_history boolean not null,
  auto_sync boolean not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  completed_at timestamptz
);
create table public.youtube_revocation_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.youtube_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  channel_id text not null,
  refresh_secret jsonb not null,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  lease_worker_id text,
  lease_until timestamptz
);
create table public.youtube_post_sources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.youtube_connections(id) on delete cascade,
  -- Minimal deletion-intent digest survives metadata removal to avoid resurrecting
  -- deleted posts. No title, URL, description or raw video ID survives removal.
  source_key text not null unique,
  video_id text,
  post_id uuid unique references public.posts(id) on delete set null,
  source_state text not null default 'active' check (source_state in ('active','user_deleted','source_removed','authorization_removed')),
  generated_title text,
  generated_body text,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index youtube_sync_due_idx on public.youtube_connections(next_sync_at) where status='connected';
create index youtube_refresh_due_idx on public.youtube_post_sources(connection_id,refreshed_at) where source_state='active';
alter table public.youtube_connections enable row level security;
alter table public.youtube_connection_secrets enable row level security;
alter table public.youtube_oauth_states enable row level security;
alter table public.youtube_post_sources enable row level security;
alter table public.youtube_revocation_jobs enable row level security;
revoke all on public.youtube_connections,public.youtube_connection_secrets,public.youtube_oauth_states,public.youtube_post_sources,public.youtube_revocation_jobs from public,anon,authenticated;
grant all on public.youtube_connections,public.youtube_connection_secrets,public.youtube_oauth_states,public.youtube_post_sources,public.youtube_revocation_jobs to service_role;

create function public._youtube_require_owner(p_owner_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Lock the profile so a concurrent moderation change cannot race publication.
  perform 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_owner_id and p.public_uid is not null and p.account_status='active'
    and (p.muted_until is null or p.muted_until<=now()) and u.email_confirmed_at is not null
  for update of p;
  if not found then raise exception 'youtube_account_ineligible'; end if;
end; $$;

create function public._youtube_view(p_connection public.youtube_connections) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',p_connection.id,'channelId',coalesce(p_connection.channel_id,''),'channelTitle',case when p_connection.channel_refreshed_at<=now()-interval '30 days' then '' else p_connection.channel_title end,
  'syncEnabled',p_connection.sync_enabled,'importHistory',p_connection.import_history,
  'historyStatus',case when p_connection.history_complete then 'complete' when p_connection.history_cursor is not null or p_connection.history_imported>0 then 'running' else 'pending' end,
  'historyImported',p_connection.history_imported,'status',p_connection.status,
  'lastSyncedAt',p_connection.last_synced_at,'lastErrorCode',p_connection.last_error_code);
$$;

create function public.youtube_get_connection(p_owner_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select public._youtube_view(c) from public.youtube_connections c where c.owner_id=p_owner_id and c.last_error_code is distinct from 'youtube_disconnected';
$$;

create function public.youtube_begin_oauth(p_owner_id uuid,p_state_hash text,p_verifier_secret jsonb,p_import_history boolean,p_auto_sync boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform public._youtube_require_owner(p_owner_id);
  if exists(select 1 from public.youtube_connections where owner_id=p_owner_id and status='revocation_pending') then raise exception 'youtube_revocation_pending'; end if;
  delete from public.youtube_oauth_states where owner_id=p_owner_id;
  insert into public.youtube_oauth_states(owner_id,state_hash,verifier_secret,import_history,auto_sync)
  values(p_owner_id,p_state_hash,p_verifier_secret,p_import_history,p_auto_sync) returning id into v_id;
  return v_id;
end; $$;

create function public.youtube_consume_oauth(p_owner_id uuid,p_state_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.youtube_oauth_states;
begin
  perform public._youtube_require_owner(p_owner_id);
  select * into s from public.youtube_oauth_states where owner_id=p_owner_id and state_hash=p_state_hash for update;
  if not found or s.consumed_at is not null or s.expires_at<=now() then raise exception 'youtube_state_invalid'; end if;
  update public.youtube_oauth_states set consumed_at=now() where id=s.id;
  return jsonb_build_object('id',s.id,'verifierSecret',s.verifier_secret);
end; $$;

create function public.youtube_complete_oauth(p_owner_id uuid,p_state_id uuid,p_channel_id text,p_channel_title text,p_uploads_playlist_id text,p_refresh_secret jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.youtube_oauth_states; c public.youtube_connections;
begin
  perform public._youtube_require_owner(p_owner_id);
  -- Serialize claims on a channel across different WaveKB accounts before the
  -- unique constraint, returning a stable conflict instead of raw SQL errors.
  perform pg_advisory_xact_lock(hashtext('wavekb-youtube:'||p_channel_id));
  select * into s from public.youtube_oauth_states where id=p_state_id and owner_id=p_owner_id for update;
  if not found or s.consumed_at is null or s.completed_at is not null or s.expires_at<=now() then raise exception 'youtube_state_invalid'; end if;
  if p_channel_id !~ '^UC[A-Za-z0-9_-]{22}$' or p_uploads_playlist_id !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'youtube_channel_invalid'; end if;
  select * into c from public.youtube_connections where owner_id=p_owner_id for update;
  if found and c.status='revocation_pending' then raise exception 'youtube_revocation_pending'; end if;
  if found and c.status='connected' and c.channel_id is distinct from p_channel_id then raise exception 'youtube_already_connected'; end if;
  if exists(select 1 from public.youtube_connections where channel_id=p_channel_id and owner_id<>p_owner_id) then raise exception 'youtube_channel_already_bound'; end if;
  insert into public.youtube_connections(owner_id,channel_id,channel_key,channel_title,uploads_playlist_id,sync_enabled,import_history,history_complete)
  values(p_owner_id,p_channel_id,md5(p_channel_id),left(p_channel_title,200),p_uploads_playlist_id,s.auto_sync,s.import_history,not s.import_history)
  on conflict(owner_id) do update set channel_id=excluded.channel_id,channel_key=excluded.channel_key,channel_title=excluded.channel_title,
    channel_refreshed_at=now(),
    uploads_playlist_id=excluded.uploads_playlist_id,status='connected',sync_enabled=excluded.sync_enabled,import_history=excluded.import_history,
    history_cursor=null,poll_cursor=null,history_complete=excluded.history_complete,
    history_imported=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.history_imported else 0 end,
    last_synced_at=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.last_synced_at else null end,
    sync_since=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.sync_since else now() end,
    next_sync_at=now(),last_error_code=null,lease_worker_id=null,lease_until=null
  returning * into c;
  -- Only fresh, explicit history consent may reimport data removed with the
  -- previous authorization. User deletion and source-removal intent survive
  -- every reconnect; the importer will still verify public ownership again.
  if s.import_history and exists(select 1 from public.youtube_post_sources
    where connection_id=c.id and source_state='authorization_removed' and post_id is null) then
    delete from public.youtube_post_sources where connection_id=c.id
      and source_state='authorization_removed' and post_id is null;
    update public.youtube_connections set history_imported=0 where id=c.id returning * into c;
  end if;
  insert into public.youtube_connection_secrets(connection_id,ciphertext,iv,auth_tag,key_version)
  values(c.id,p_refresh_secret->>'ciphertext',p_refresh_secret->>'iv',p_refresh_secret->>'auth_tag',(p_refresh_secret->>'key_version')::int)
  on conflict(connection_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,key_version=excluded.key_version;
  update public.youtube_oauth_states set completed_at=now(),verifier_secret='{}'::jsonb where id=s.id;
  return public._youtube_view(c);
end; $$;

create function public.youtube_settings(p_owner_id uuid,p_sync_enabled boolean,p_restart_history boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections;
begin
  perform public._youtube_require_owner(p_owner_id);
  select * into c from public.youtube_connections where owner_id=p_owner_id for update;
  if not found then raise exception 'youtube_not_connected'; end if;
  if c.status<>'connected' then raise exception 'youtube_reconnect_required'; end if;
  update public.youtube_connections set sync_enabled=p_sync_enabled,
    import_history=case when p_restart_history then true else import_history end,
    history_complete=case when p_restart_history then false else history_complete end,
    history_cursor=case when p_restart_history then null else history_cursor end,
    next_sync_at=now() where id=c.id returning * into c;
  return public._youtube_view(c);
end; $$;

create function public._youtube_post_deleted() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.youtube_post_sources set source_state='user_deleted',video_id=null,generated_title=null,generated_body=null
  where post_id=old.id and source_state='active';
  return old;
end; $$;
create trigger youtube_post_deleted before delete on public.posts for each row execute function public._youtube_post_deleted();

-- Importing an old upload is not a new authored research contribution. The
-- source row is inserted before publication, making this guard transactional.
do $migration$ begin
  if to_regprocedure('public.reward_post_published()') is not null then
    execute $definition$
      create or replace function public.reward_post_published() returns trigger
      language plpgsql security definer set search_path='' as $reward$
      declare v_points integer;
      begin
        if new.status='published' and coalesce(old.status,'')<>'published'
          and not exists(select 1 from public.youtube_post_sources where post_id=new.id) then
          v_points:=case new.board when 'case_submission' then 15 when 'idea_sharing' then 12 else 10 end;
          perform public.award_reward_points(new.author_id,'post_published',new.id::text,v_points,'发布公开研究内容');
        end if;
        return new;
      end; $reward$;
    $definition$;
  end if;
end; $migration$;

create function public._youtube_remove_generated(p_connection_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_removed integer;
begin
  update public.youtube_post_sources set source_state=case when source_state in ('user_deleted','source_removed') then source_state else 'authorization_removed' end,
    video_id=null,generated_title=null,generated_body=null where connection_id=p_connection_id;
  delete from public.posts where id in(select post_id from public.youtube_post_sources where connection_id=p_connection_id);
  get diagnostics v_removed=row_count;
  return v_removed;
end; $$;

create function public.youtube_disconnect(p_owner_id uuid,p_confirm_remove boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections; v_removed integer; s public.youtube_connection_secrets; v_job uuid;
begin
  if not p_confirm_remove then raise exception 'youtube_disconnect_confirmation_required'; end if;
  select * into c from public.youtube_connections where owner_id=p_owner_id for update;
  if not found then return jsonb_build_object('disconnected',true,'removedPosts',0); end if;
  select * into s from public.youtube_connection_secrets where connection_id=c.id;
  if found and c.channel_id is not null then
    insert into public.youtube_revocation_jobs(connection_id,owner_id,channel_id,refresh_secret)
    values(c.id,c.owner_id,c.channel_id,jsonb_build_object('ciphertext',s.ciphertext,'iv',s.iv,'auth_tag',s.auth_tag,'key_version',s.key_version))
    on conflict(connection_id) do nothing;
  end if;
  select id into v_job from public.youtube_revocation_jobs where connection_id=c.id;
  v_removed:=public._youtube_remove_generated(c.id);
  delete from public.youtube_connection_secrets where connection_id=c.id;
  delete from public.youtube_oauth_states where owner_id=p_owner_id;
  update public.youtube_connections set channel_id=null,channel_title='',uploads_playlist_id='',status=case when v_job is null then 'reconnect_required' else 'revocation_pending' end,sync_enabled=false,
    import_history=false,history_complete=true,history_cursor=null,poll_cursor=null,last_error_code=case when v_job is null then 'youtube_disconnected' else 'youtube_revocation_pending' end,lease_worker_id=null,lease_until=null where id=c.id;
  return jsonb_build_object('disconnected',true,'removedPosts',v_removed,'remoteRevocationPending',v_job is not null,'revocationId',v_job);
end; $$;

create function public.youtube_claim_sync(p_worker_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections; s public.youtube_connection_secrets;
begin
  if char_length(p_worker_id) not between 1 and 150 then raise exception 'youtube_worker_invalid'; end if;
  select q.* into c from public.youtube_connections q join public.profiles p on p.id=q.owner_id join auth.users u on u.id=p.id
  where q.status='connected' and q.next_sync_at<=now() and (q.lease_until is null or q.lease_until<=now())
    and p.public_uid is not null and p.account_status='active' and (p.muted_until is null or p.muted_until<=now()) and u.email_confirmed_at is not null
  order by q.next_sync_at,q.id for update of q skip locked limit 1;
  if not found then return null; end if;
  select * into s from public.youtube_connection_secrets where connection_id=c.id;
  if not found then raise exception 'youtube_reconnect_required'; end if;
  update public.youtube_connections set lease_worker_id=p_worker_id,lease_until=now()+interval '3 minutes' where id=c.id;
  return jsonb_build_object('id',c.id,'ownerId',c.owner_id,'channelId',c.channel_id,'uploadsPlaylistId',c.uploads_playlist_id,
    'refreshSecret',jsonb_build_object('ciphertext',s.ciphertext,'iv',s.iv,'auth_tag',s.auth_tag,'key_version',s.key_version),
    'historyCursor',c.history_cursor,'pollCursor',c.poll_cursor,'historyComplete',c.history_complete,'syncEnabled',c.sync_enabled,'syncSince',c.sync_since,'lastSyncedAt',c.last_synced_at,'leaseWorkerId',p_worker_id);
end; $$;

create function public._youtube_lock_lease(p_connection_id uuid,p_worker_id text) returns public.youtube_connections
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections;
begin
  select * into c from public.youtube_connections where id=p_connection_id for update;
  if not found or c.status<>'connected' or p_worker_id is null or c.lease_worker_id is null or c.lease_until is null
    or c.lease_worker_id is distinct from p_worker_id or c.lease_until<=now() then raise exception 'youtube_lease_lost'; end if;
  return c;
end; $$;

create function public.youtube_commit_page(p_connection_id uuid,p_worker_id text,p_expected_cursor text,p_next_cursor text,p_videos jsonb,p_history_complete boolean,p_mode text) returns jsonb
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
    values('idea_sharing',v_title,v_body,c.owner_id,'draft','https://www.youtube.com/watch?v='||(v->>'id'),'youtube') returning id into p_id;
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

create function public.youtube_old_video_ids(p_connection_id uuid,p_worker_id text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public._youtube_lock_lease(p_connection_id,p_worker_id);
  return coalesce((select jsonb_agg(q.video_id) from(select video_id from public.youtube_post_sources where connection_id=p_connection_id and source_state='active'
    and refreshed_at<=now()-interval '1 day' order by refreshed_at limit least(greatest(p_limit,1),50))q),'[]'::jsonb);
end; $$;

create function public.youtube_rotate_secret(p_connection_id uuid,p_worker_id text,p_refresh_secret jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public._youtube_lock_lease(p_connection_id,p_worker_id);
  update public.youtube_connection_secrets set ciphertext=p_refresh_secret->>'ciphertext',iv=p_refresh_secret->>'iv',
    auth_tag=p_refresh_secret->>'auth_tag',key_version=(p_refresh_secret->>'key_version')::int where connection_id=p_connection_id;
end; $$;

create function public.youtube_update_channel(p_connection_id uuid,p_worker_id text,p_channel_title text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public._youtube_lock_lease(p_connection_id,p_worker_id);
  update public.youtube_connections set channel_title=left(p_channel_title,200),channel_refreshed_at=now() where id=p_connection_id;
end; $$;

create function public.youtube_refresh_videos(p_connection_id uuid,p_worker_id text,p_videos jsonb,p_checked_ids jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections; source public.youtube_post_sources; v jsonb; v_title text; v_body text;
begin
  c:=public._youtube_lock_lease(p_connection_id,p_worker_id);
  if jsonb_typeof(p_videos) is distinct from 'array' or jsonb_typeof(p_checked_ids) is distinct from 'array' or jsonb_array_length(p_checked_ids)>50 then raise exception 'youtube_page_invalid'; end if;
  for source in select * from public.youtube_post_sources where connection_id=c.id and source_state='active'
    and video_id in(select jsonb_array_elements_text(p_checked_ids)) for update loop
    select value into v from jsonb_array_elements(p_videos) where value->>'id'=source.video_id limit 1;
    if v is null or v->>'privacyStatus' is distinct from 'public' or v->>'channelId' is distinct from c.channel_id then
      update public.youtube_post_sources set source_state='source_removed',video_id=null,generated_title=null,generated_body=null where id=source.id;
      delete from public.posts where id=source.post_id;
    else
      v_title:=left(trim(coalesce(v->>'title','')),120);
      if char_length(v_title)<5 then v_title:=left('YouTube 视频：'||v_title,120); end if;
      v_body:=left(trim(coalesce(v->>'description','')),19000)||E'\n\n本帖由作者授权同步自 YouTube。原视频：https://www.youtube.com/watch?v='||source.video_id;
      -- User edits and moderation take precedence; never unhide a moderated post.
      update public.posts set title=v_title,body=v_body where id=source.post_id and status='published' and title=source.generated_title and body=source.generated_body;
      update public.youtube_post_sources set generated_title=v_title,generated_body=v_body,refreshed_at=now() where id=source.id;
    end if;
  end loop;
end; $$;

create function public.youtube_release_sync(p_connection_id uuid,p_worker_id text,p_error_code text,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.youtube_connections set lease_worker_id=null,lease_until=null,last_error_code=left(p_error_code,80),
    next_sync_at=coalesce(p_retry_at,now()+interval '10 minutes') where id=p_connection_id and lease_worker_id=p_worker_id;
end; $$;

create function public.youtube_mark_reconnect(p_connection_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.youtube_connections;
begin
  c:=public._youtube_lock_lease(p_connection_id,p_worker_id);
  perform public._youtube_remove_generated(c.id);
  delete from public.youtube_connection_secrets where connection_id=c.id;
  update public.youtube_connections set status='reconnect_required',sync_enabled=false,channel_id=null,channel_title='',uploads_playlist_id='',
    history_cursor=null,poll_cursor=null,last_error_code='youtube_reconnect_required',lease_worker_id=null,lease_until=null where id=c.id;
end; $$;

create function public.youtube_cleanup_stale_data() returns void
language plpgsql security definer set search_path='' as $$
declare source public.youtube_post_sources;
begin
  delete from public.youtube_oauth_states where expires_at<=now();
  update public.youtube_connections set status='reconnect_required',last_error_code='youtube_manual_revocation_required'
  where id in(select connection_id from public.youtube_revocation_jobs where expires_at<=now());
  delete from public.youtube_revocation_jobs where expires_at<=now();
  update public.youtube_connections set channel_title='' where channel_refreshed_at<=now()-interval '30 days';
  for source in select * from public.youtube_post_sources where source_state='active' and refreshed_at<=now()-interval '30 days' for update loop
    update public.youtube_post_sources set source_state='source_removed',video_id=null,generated_title=null,generated_body=null where id=source.id;
    delete from public.posts where id=source.post_id;
  end loop;
end; $$;

create function public.youtube_claim_revocation(p_worker_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.youtube_revocation_jobs;
begin
  select * into j from public.youtube_revocation_jobs where next_attempt_at<=now() and expires_at>now()
    and (lease_until is null or lease_until<=now()) order by next_attempt_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.youtube_revocation_jobs set lease_worker_id=p_worker_id,lease_until=now()+interval '3 minutes' where id=j.id;
  return jsonb_build_object('id',j.id,'ownerId',j.owner_id,'channelId',j.channel_id,'refreshSecret',j.refresh_secret);
end; $$;

create function public.youtube_complete_revocation(p_job_id uuid,p_worker_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.youtube_revocation_jobs;
begin
  select * into j from public.youtube_revocation_jobs where id=p_job_id for update;
  if not found then return; end if;
  if p_worker_id is not null and (j.lease_worker_id is distinct from p_worker_id or j.lease_until<=now()) then raise exception 'youtube_lease_lost'; end if;
  delete from public.youtube_revocation_jobs where id=j.id;
  update public.youtube_connections set status='reconnect_required',last_error_code='youtube_disconnected' where id=j.connection_id;
end; $$;

create function public.youtube_release_revocation(p_job_id uuid,p_worker_id text,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.youtube_revocation_jobs set lease_worker_id=null,lease_until=null,next_attempt_at=coalesce(p_retry_at,now()+interval '10 minutes')
  where id=p_job_id and lease_worker_id=p_worker_id;
end; $$;

create function public._youtube_post_is_fresh(p_post_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.youtube_post_sources s where s.post_id=p_post_id
    and (s.source_state<>'active' or s.refreshed_at<=now()-interval '30 days'));
$$;
-- This is restrictive: it can only narrow existing read policies, including
-- admin policies. Ordinary/manual posts have no source row and are unaffected.
create policy "youtube generated posts require fresh source" on public.posts as restrictive for select to anon,authenticated
using(public._youtube_post_is_fresh(id));

-- Every helper and RPC is service-only, including view and lease helpers.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'youtube\_%' escape '\' or p.proname like '\_youtube\_%' escape '\') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.name);
    execute format('grant execute on function %s to service_role',f.name);
  end loop;
end; $$;
grant execute on function public._youtube_post_is_fresh(uuid) to anon,authenticated;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path='' as $$ select '202610080004'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon,authenticated;
notify pgrst, 'reload schema';

commit;
