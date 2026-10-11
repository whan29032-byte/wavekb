begin;

-- Evidence belongs only to this YouTube authorization. Existing connections and
-- in-flight states remain NULL: no consent is inferred from earlier opt-ins.
alter table public.youtube_oauth_states
  add column privacy_terms_policy_version text,
  add column privacy_terms_accepted_at timestamptz,
  add constraint youtube_oauth_states_policy_receipt check (
    (privacy_terms_policy_version is null and privacy_terms_accepted_at is null)
    or (privacy_terms_policy_version = '2026-10-11-youtube-v1' and privacy_terms_policy_version is not null and privacy_terms_accepted_at is not null)
  );
alter table public.youtube_connections
  add column privacy_terms_policy_version text,
  add column privacy_terms_accepted_at timestamptz,
  add constraint youtube_connections_policy_receipt check (
    (privacy_terms_policy_version is null and privacy_terms_accepted_at is null)
    or (privacy_terms_policy_version = '2026-10-11-youtube-v1' and privacy_terms_policy_version is not null and privacy_terms_accepted_at is not null)
  );

-- Keep the legacy signature recognizable, but prevent it from opening states.
-- It has no caller grants, including service_role; privileged local callers
-- also fail closed with the same safe error instead of fabricating consent.
create or replace function public.youtube_begin_oauth(p_owner_id uuid,p_state_hash text,p_verifier_secret jsonb,p_import_history boolean,p_auto_sync boolean) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  raise exception 'youtube_policy_consent_required';
end; $$;
revoke all on function public.youtube_begin_oauth(uuid,text,jsonb,boolean,boolean) from public,anon,authenticated,service_role;

create function public.youtube_begin_oauth(p_owner_id uuid,p_state_hash text,p_verifier_secret jsonb,p_import_history boolean,p_auto_sync boolean,p_privacy_terms_accepted boolean,p_policy_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_privacy_terms_accepted is distinct from true or p_policy_version is distinct from '2026-10-11-youtube-v1' then
    raise exception 'youtube_policy_consent_required';
  end if;
  perform public._youtube_require_owner(p_owner_id);
  if exists(select 1 from public.youtube_connections where owner_id=p_owner_id and status='revocation_pending') then raise exception 'youtube_revocation_pending'; end if;
  delete from public.youtube_oauth_states where owner_id=p_owner_id;
  -- Only server time is recorded; no timestamp, IP or user-agent is accepted.
  insert into public.youtube_oauth_states(owner_id,state_hash,verifier_secret,import_history,auto_sync,privacy_terms_policy_version,privacy_terms_accepted_at)
  values(p_owner_id,p_state_hash,p_verifier_secret,p_import_history,p_auto_sync,p_policy_version,now()) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.youtube_begin_oauth(uuid,text,jsonb,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.youtube_begin_oauth(uuid,text,jsonb,boolean,boolean,boolean,text) to service_role;

create or replace function public.youtube_consume_oauth(p_owner_id uuid,p_state_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.youtube_oauth_states;
begin
  perform public._youtube_require_owner(p_owner_id);
  select * into s from public.youtube_oauth_states where owner_id=p_owner_id and state_hash=p_state_hash for update;
  if not found or s.consumed_at is not null or s.expires_at<=now() then raise exception 'youtube_state_invalid'; end if;
  if s.privacy_terms_policy_version is distinct from '2026-10-11-youtube-v1' or s.privacy_terms_accepted_at is null then raise exception 'youtube_policy_consent_required'; end if;
  update public.youtube_oauth_states set consumed_at=now() where id=s.id;
  return jsonb_build_object('id',s.id,'verifierSecret',s.verifier_secret);
end; $$;

create or replace function public.youtube_complete_oauth(p_owner_id uuid,p_state_id uuid,p_channel_id text,p_channel_title text,p_uploads_playlist_id text,p_refresh_secret jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.youtube_oauth_states; c public.youtube_connections;
begin
  perform public._youtube_require_owner(p_owner_id);
  -- Retain profile, channel and state lock order for owner and channel safety.
  perform pg_advisory_xact_lock(hashtext('wavekb-youtube:'||p_channel_id));
  select * into s from public.youtube_oauth_states where id=p_state_id and owner_id=p_owner_id for update;
  if not found or s.consumed_at is null or s.completed_at is not null or s.expires_at<=now() then raise exception 'youtube_state_invalid'; end if;
  if s.privacy_terms_policy_version is distinct from '2026-10-11-youtube-v1' or s.privacy_terms_accepted_at is null then raise exception 'youtube_policy_consent_required'; end if;
  if p_channel_id !~ '^UC[A-Za-z0-9_-]{22}$' or p_uploads_playlist_id !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'youtube_channel_invalid'; end if;
  select * into c from public.youtube_connections where owner_id=p_owner_id for update;
  if found and c.status='revocation_pending' then raise exception 'youtube_revocation_pending'; end if;
  if found and c.status='connected' and c.channel_id is distinct from p_channel_id then raise exception 'youtube_already_connected'; end if;
  if exists(select 1 from public.youtube_connections where channel_id=p_channel_id and owner_id<>p_owner_id) then raise exception 'youtube_channel_already_bound'; end if;
  insert into public.youtube_connections(owner_id,channel_id,channel_key,channel_title,uploads_playlist_id,sync_enabled,import_history,history_complete,privacy_terms_policy_version,privacy_terms_accepted_at)
  values(p_owner_id,p_channel_id,md5(p_channel_id),left(p_channel_title,200),p_uploads_playlist_id,s.auto_sync,s.import_history,not s.import_history,s.privacy_terms_policy_version,s.privacy_terms_accepted_at)
  on conflict(owner_id) do update set channel_id=excluded.channel_id,channel_key=excluded.channel_key,channel_title=excluded.channel_title,
    channel_refreshed_at=now(),
    uploads_playlist_id=excluded.uploads_playlist_id,status='connected',sync_enabled=excluded.sync_enabled,import_history=excluded.import_history,
    privacy_terms_policy_version=excluded.privacy_terms_policy_version,privacy_terms_accepted_at=excluded.privacy_terms_accepted_at,
    history_cursor=null,poll_cursor=null,history_complete=excluded.history_complete,
    history_imported=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.history_imported else 0 end,
    last_synced_at=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.last_synced_at else null end,
    sync_since=case when youtube_connections.channel_key=excluded.channel_key then youtube_connections.sync_since else now() end,
    next_sync_at=now(),last_error_code=null,lease_worker_id=null,lease_until=null
  returning * into c;
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
revoke all on function public.youtube_consume_oauth(uuid,text),public.youtube_complete_oauth(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.youtube_consume_oauth(uuid,text),public.youtube_complete_oauth(uuid,uuid,text,text,text,jsonb) to service_role;

-- The new nullable receipt columns inherit the tables' existing service-only
-- grants and RLS. No receipt is included in the owner-facing connection view.
create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path='' as $$ select '20261011152711'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon,authenticated;
notify pgrst, 'reload schema';

commit;
