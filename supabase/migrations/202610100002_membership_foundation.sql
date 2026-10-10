-- Independent, manually managed membership. No prices, subscriptions or billing
-- are enabled by this migration; public content and profiles.role are unchanged.
begin;

-- Match ECMAScript String.trim() exactly, including NBSP and Unicode spaces.
-- Membership limits count Unicode code points (PostgreSQL length), not UTF-16.
create function public.membership_trim_text(p_value text)
returns text language sql immutable strict set search_path='' as $$
  select pg_catalog.btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function public.membership_trim_text(text) from public,anon,authenticated;

create table public.membership_plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  title text not null check (length(public.membership_trim_text(title)) between 2 and 60),
  description text not null default '' check (length(description) <= 1000),
  benefits jsonb not null default '{}' check (jsonb_typeof(benefits) = 'object'),
  enabled boolean not null default false,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.membership_plans(key,title,description) values
  ('vip','VIP 会员','会员方案待确认；未开放购买，不影响现有公开内容。');

create table public.membership_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  plan_key text not null references public.membership_plans(key) on delete restrict,
  status text not null check (status in ('active','revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null check (isfinite(ends_at)),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(user_id,plan_key),
  check (ends_at > starts_at)
);
create table public.membership_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete restrict,
  plan_key text not null references public.membership_plans(key) on delete restrict,
  action text not null check (action in ('plan_updated','granted','extended','revoked')),
  reason text not null check (length(public.membership_trim_text(reason)) between 3 and 500),
  request jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
-- now() can be identical for multiple events in one transaction. UUIDs do not
-- encode write order, so use an internally generated tiebreaker for history.
-- This additive statement also preserves preexisting event IDs and payloads;
-- backfilled historical ties become stable, not reconstructed commit times.
alter table public.membership_events
  add column if not exists event_sequence bigint generated always as identity;
create unique index membership_events_sequence on public.membership_events(event_sequence);
create index membership_events_user_time on public.membership_events(user_id,created_at desc,event_sequence desc);
revoke all on sequence public.membership_events_event_sequence_seq from public,anon,authenticated;
alter table public.membership_plans enable row level security;
alter table public.membership_grants enable row level security;
alter table public.membership_events enable row level security;
-- No direct writes, even for admins: all changes go through audited RPCs.
revoke all on public.membership_plans,public.membership_grants,public.membership_events from public,anon,authenticated;

create function public.has_membership_entitlement(p_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.account_is_active() and exists (
    select 1 from public.membership_grants g join public.membership_plans p on p.key=g.plan_key
    where g.user_id=auth.uid() and g.status='active' and g.starts_at<=now()
      and g.ends_at>now() and p.enabled and p.benefits ? p_key
  );
$$;

create function public.get_my_membership()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.account_is_active() then raise exception 'account_ineligible'; end if;
  return jsonb_build_object('billing_enabled',false,'grants',coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'plan_key',g.plan_key,'title',p.title,
      'status',case when g.status='revoked' then 'revoked' when not p.enabled then 'disabled'
        when g.starts_at>now() then 'scheduled' when g.ends_at<=now() then 'expired' else 'active' end,
      'starts_at',g.starts_at,'ends_at',g.ends_at,'revision',g.revision,
      'benefits',case when p.enabled and g.status='active' and g.starts_at<=now() and g.ends_at>now() then p.benefits else '{}'::jsonb end)
      order by g.ends_at desc) from public.membership_grants g join public.membership_plans p on p.key=g.plan_key where g.user_id=auth.uid()
  ),'[]'::jsonb),'history',coalesce((
    select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'title',p.title,'created_at',e.created_at,
      'ends_at',e.after_state->>'ends_at') order by e.created_at desc,e.event_sequence desc)
    from (select * from public.membership_events where user_id=auth.uid() order by created_at desc,event_sequence desc limit 50) e
    join public.membership_plans p on p.key=e.plan_key
  ),'[]'::jsonb));
end;
$$;

create function public.admin_membership_store(p_public_uid bigint default null,p_actor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_user uuid;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_public_uid is not null then
    select id into v_user from public.profiles where public_uid=p_public_uid;
    if v_user is null then raise exception 'member_not_found'; end if;
  end if;
  return jsonb_build_object('plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.key) from public.membership_plans p),'[]'::jsonb),
    'member',(select jsonb_build_object('id',id,'public_uid',public_uid,'display_name',display_name,'account_status',account_status) from public.profiles where id=v_user),
    'grants',coalesce((select jsonb_agg(to_jsonb(g) order by g.updated_at desc) from public.membership_grants g where g.user_id=v_user),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(e)-'request'-'event_sequence' order by e.created_at desc,e.event_sequence desc) from
      (select * from public.membership_events where user_id=v_user or user_id is null order by created_at desc,event_sequence desc limit 50) e),'[]'::jsonb));
end;
$$;

create function public.admin_save_membership_plan(p_key text,p_title text,p_description text,p_benefits jsonb,p_enabled boolean,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before public.membership_plans; v_after public.membership_plans; v_event public.membership_events; v_request jsonb; v_benefits jsonb;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_request_id is null or p_enabled is null or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500
    or p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,39}$' or p_title is null or length(public.membership_trim_text(p_title)) not between 2 and 60
    or length(coalesce(p_description,''))>1000
    or p_expected_revision is null or p_expected_revision<0 then raise exception 'membership_input_invalid'; end if;
  if p_benefits is null or jsonb_typeof(p_benefits)<>'object' then raise exception 'membership_benefits_invalid'; end if;
  if (select count(*) from jsonb_each(p_benefits))>20 or exists (select 1 from jsonb_each(p_benefits) b
    where b.key !~ '^[a-z][a-z0-9_]{1,59}$' or jsonb_typeof(b.value)<>'string' or length(public.membership_trim_text(b.value#>>'{}')) not between 1 and 240) then raise exception 'membership_benefits_invalid'; end if;
  select coalesce(jsonb_object_agg(b.key,public.membership_trim_text(b.value#>>'{}')),'{}'::jsonb) into v_benefits from jsonb_each(p_benefits) b;
  v_request:=jsonb_build_object('key',p_key,'title',p_title,'description',p_description,'benefits',p_benefits,'enabled',p_enabled,'revision',p_expected_revision,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_event from public.membership_events where request_id=p_request_id;
  if found then
    if v_event.actor_id<>auth.uid() or v_event.action<>'plan_updated' or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('membership_plan:'||p_key,0));
  select * into v_before from public.membership_plans where key=p_key for update;
  if coalesce(v_before.revision,0)<>coalesce(p_expected_revision,0) then raise exception 'membership_changed_concurrently'; end if;
  insert into public.membership_plans(key,title,description,benefits,enabled) values(p_key,public.membership_trim_text(p_title),coalesce(p_description,''),v_benefits,p_enabled)
    on conflict(key) do update set title=excluded.title,description=excluded.description,benefits=excluded.benefits,enabled=excluded.enabled,
      revision=membership_plans.revision+1,updated_at=now() returning * into v_after;
  insert into public.membership_events(request_id,actor_id,plan_key,action,reason,request,before_state,after_state)
    values(p_request_id,auth.uid(),p_key,'plan_updated',public.membership_trim_text(p_reason),v_request,case when v_before.key is null then null else to_jsonb(v_before) end,to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

create function public.admin_change_membership(p_user_id uuid,p_plan_key text,p_action text,p_ends_at timestamptz,p_expected_revision integer,p_reason text,p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before public.membership_grants; v_after public.membership_grants; v_event public.membership_events; v_request jsonb; v_enabled boolean;
begin
  if not public.is_admin() or p_actor_id is distinct from auth.uid() then raise exception 'admin_required'; end if;
  if p_request_id is null or p_action not in ('grant','extend','revoke') or p_action is null
    or p_reason is null or length(public.membership_trim_text(p_reason)) not between 3 and 500 or p_expected_revision is null or p_expected_revision<0
    or p_user_id is null or p_plan_key is null then raise exception 'membership_input_invalid'; end if;
  v_request:=jsonb_build_object('user_id',p_user_id,'plan_key',p_plan_key,'action',p_action,'ends_at',p_ends_at,'revision',p_expected_revision,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_event from public.membership_events where request_id=p_request_id;
  if found then
    if v_event.actor_id<>auth.uid() or v_event.request<>v_request then raise exception 'request_conflict'; end if;
    return v_event.after_state;
  end if;
  -- Lock the member row, serializing grants for the same account.
  perform 1 from public.profiles where id=p_user_id for no key update;
  if not found then raise exception 'member_not_found'; end if;
  if p_action<>'revoke' and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user_id and p.account_status='active' and p.public_uid is not null and u.email_confirmed_at is not null) then raise exception 'account_ineligible'; end if;
  select enabled into v_enabled from public.membership_plans where key=p_plan_key for share;
  if not found or (p_action<>'revoke' and not v_enabled) then raise exception 'membership_plan_disabled'; end if;
  select * into v_before from public.membership_grants where user_id=p_user_id and plan_key=p_plan_key for update;
  if coalesce(v_before.revision,0)<>coalesce(p_expected_revision,0) then raise exception 'membership_changed_concurrently'; end if;
  if p_action='revoke' then
    if v_before.id is null or v_before.status<>'active' then raise exception 'membership_not_active'; end if;
    update public.membership_grants set status='revoked',revision=revision+1,updated_at=now() where id=v_before.id returning * into v_after;
  else
    if p_ends_at is null or not isfinite(p_ends_at) or p_ends_at<=now() or p_ends_at>now()+interval '5 years' then raise exception 'membership_dates_invalid'; end if;
    if p_action='extend' and (v_before.id is null or v_before.status<>'active' or p_ends_at<=v_before.ends_at) then raise exception 'membership_extension_invalid'; end if;
    if p_action='grant' and v_before.status='active' and v_before.ends_at>now() then raise exception 'membership_already_active'; end if;
    insert into public.membership_grants(user_id,plan_key,status,starts_at,ends_at) values(p_user_id,p_plan_key,'active',now(),p_ends_at)
      on conflict(user_id,plan_key) do update set status='active',starts_at=case when p_action='extend' then membership_grants.starts_at else now() end,
        ends_at=excluded.ends_at,revision=membership_grants.revision+1,updated_at=now() returning * into v_after;
  end if;
  insert into public.membership_events(request_id,actor_id,user_id,plan_key,action,reason,request,before_state,after_state)
    values(p_request_id,auth.uid(),p_user_id,p_plan_key,case p_action when 'grant' then 'granted' when 'extend' then 'extended' else 'revoked' end,public.membership_trim_text(p_reason),v_request,
      case when v_before.id is null then null else to_jsonb(v_before) end,to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

revoke all on function public.has_membership_entitlement(text),public.get_my_membership(),public.admin_membership_store(bigint,uuid),
  public.admin_save_membership_plan(text,text,text,jsonb,boolean,integer,text,uuid,uuid),public.admin_change_membership(uuid,text,text,timestamptz,integer,text,uuid,uuid) from public,anon;
grant execute on function public.has_membership_entitlement(text),public.get_my_membership(),public.admin_membership_store(bigint,uuid),
  public.admin_save_membership_plan(text,text,text,jsonb,boolean,integer,text,uuid,uuid),public.admin_change_membership(uuid,text,text,timestamptz,integer,text,uuid,uuid) to authenticated;
create or replace function public.wavekb_schema_version() returns text language sql stable as $$ select '202610100002'::text $$;
grant execute on function public.wavekb_schema_version() to anon,authenticated;
notify pgrst,'reload schema';
commit;
