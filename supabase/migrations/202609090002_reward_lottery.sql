begin;

create table public.reward_lottery_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  description text not null default '',
  image_url text,
  entry_cost_points integer not null check (entry_cost_points > 0 and entry_cost_points <= 100000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index reward_lottery_one_active_campaign
  on public.reward_lottery_campaigns ((status))
  where status = 'active';

create table public.reward_lottery_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.reward_lottery_campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  summary text not null default '',
  image_url text,
  probability_bps integer not null check (probability_bps between 1 and 10000),
  stock_total integer not null check (stock_total >= 0),
  stock_remaining integer not null check (stock_remaining >= 0 and stock_remaining <= stock_total),
  fulfillment_type text not null check (fulfillment_type in ('points', 'manual')),
  reward_points integer,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (fulfillment_type = 'points' and reward_points is not null and reward_points > 0)
    or (fulfillment_type = 'manual' and reward_points is null)
  )
);

create index reward_lottery_prizes_campaign_order
  on public.reward_lottery_prizes(campaign_id, sort_order, created_at);

create table public.reward_lottery_draws (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.reward_lottery_campaigns(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  prize_id uuid references public.reward_lottery_prizes(id) on delete restrict,
  outcome text not null check (outcome in ('won', 'miss')),
  campaign_snapshot jsonb not null,
  prize_snapshot jsonb,
  entry_cost_points integer not null check (entry_cost_points > 0),
  random_bucket integer not null check (random_bucket between 0 and 9999),
  fulfillment_status text not null check (fulfillment_status in ('not_required', 'pending', 'fulfilled')),
  fulfillment_note text not null default '',
  fulfilled_by uuid references public.profiles(id) on delete set null,
  fulfilled_at timestamptz,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id),
  unique (user_id, request_id),
  check ((outcome = 'won' and prize_id is not null and prize_snapshot is not null) or (outcome = 'miss' and prize_id is null and prize_snapshot is null))
);

create index reward_lottery_draws_created_at
  on public.reward_lottery_draws(created_at desc);

create table public.reward_lottery_admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  campaign_id uuid references public.reward_lottery_campaigns(id) on delete set null,
  prize_id uuid references public.reward_lottery_prizes(id) on delete set null,
  draw_id uuid references public.reward_lottery_draws(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.reward_lottery_campaigns enable row level security;
alter table public.reward_lottery_prizes enable row level security;
alter table public.reward_lottery_draws enable row level security;
alter table public.reward_lottery_admin_audit enable row level security;

revoke all on table public.reward_lottery_campaigns from public, anon, authenticated;
revoke all on table public.reward_lottery_prizes from public, anon, authenticated;
revoke all on table public.reward_lottery_draws from public, anon, authenticated;
revoke all on table public.reward_lottery_admin_audit from public, anon, authenticated;

create or replace function public.reward_lottery_random_bucket()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_value integer;
begin
  loop
    v_bytes := extensions.gen_random_bytes(2);
    v_value := pg_catalog.get_byte(v_bytes, 0) * 256 + pg_catalog.get_byte(v_bytes, 1);
    exit when v_value < 60000;
  end loop;
  return v_value % 10000;
end;
$$;

create or replace function public.reward_lottery_draw_payload(p_draw_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'draw_id', draw.id,
    'campaign_id', draw.campaign_id,
    'outcome', draw.outcome,
    'prize', draw.prize_snapshot,
    'entry_cost_points', draw.entry_cost_points,
    'random_bucket', draw.random_bucket,
    'fulfillment_status', draw.fulfillment_status,
    'fulfillment_note', draw.fulfillment_note,
    'balance', draw.balance_after,
    'created_at', draw.created_at
  )
  from public.reward_lottery_draws draw
  where draw.id = p_draw_id;
$$;

create or replace function public.get_my_reward_lottery()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_campaign public.reward_lottery_campaigns%rowtype;
  v_profile public.profiles%rowtype;
  v_balance integer := 0;
  v_draw_id uuid;
  v_effective_probability integer := 0;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  select * into v_campaign
  from public.reward_lottery_campaigns campaign
  where campaign.status = 'active'
  order by campaign.activated_at desc nulls last, campaign.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles profile where profile.id = v_user;
  select coalesce(wallet.balance, 0) into v_balance
  from public.reward_wallets wallet where wallet.user_id = v_user;
  select draw.id into v_draw_id
  from public.reward_lottery_draws draw
  where draw.campaign_id = v_campaign.id and draw.user_id = v_user;
  select coalesce(sum(prize.probability_bps) filter (where prize.stock_remaining > 0), 0)::integer
  into v_effective_probability
  from public.reward_lottery_prizes prize
  where prize.campaign_id = v_campaign.id;

  return jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', v_campaign.id,
      'title', v_campaign.title,
      'description', v_campaign.description,
      'image_url', v_campaign.image_url,
      'entry_cost_points', v_campaign.entry_cost_points,
      'starts_at', v_campaign.starts_at,
      'ends_at', v_campaign.ends_at,
      'status', v_campaign.status
    ),
    'availability', case
      when now() < v_campaign.starts_at then 'scheduled'
      when now() >= v_campaign.ends_at then 'ended'
      else 'open'
    end,
    'eligible', coalesce(v_profile.account_status = 'active' and v_profile.public_uid is not null, false)
      and v_draw_id is null
      and now() >= v_campaign.starts_at and now() < v_campaign.ends_at
      and v_balance >= v_campaign.entry_cost_points,
    'eligibility_reason', case
      when v_profile.id is null or v_profile.account_status <> 'active' or v_profile.public_uid is null then 'account_ineligible'
      when v_draw_id is not null then 'already_drawn'
      when now() < v_campaign.starts_at or now() >= v_campaign.ends_at then 'not_open'
      when v_balance < v_campaign.entry_cost_points then 'insufficient_balance'
      else 'eligible'
    end,
    'balance', v_balance,
    'effective_miss_probability_bps', 10000 - least(10000, v_effective_probability),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', prize.id,
        'name', prize.name,
        'summary', prize.summary,
        'image_url', prize.image_url,
        'probability_bps', prize.probability_bps,
        'stock_total', prize.stock_total,
        'stock_remaining', prize.stock_remaining,
        'fulfillment_type', prize.fulfillment_type,
        'reward_points', prize.reward_points
      ) order by prize.sort_order, prize.created_at)
      from public.reward_lottery_prizes prize
      where prize.campaign_id = v_campaign.id
    ), '[]'::jsonb),
    'draw', case when v_draw_id is null then null else public.reward_lottery_draw_payload(v_draw_id) end
  );
end;
$$;

create or replace function public.draw_reward_lottery(p_campaign_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_campaign public.reward_lottery_campaigns%rowtype;
  v_prize public.reward_lottery_prizes%rowtype;
  v_existing uuid;
  v_draw_id uuid := gen_random_uuid();
  v_bucket integer;
  v_balance integer;
  v_upper integer;
  v_won boolean := false;
  v_prize_snapshot jsonb;
  v_fulfillment text := 'not_required';
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_campaign_id is null or p_request_id is null then raise exception 'lottery_request_invalid'; end if;

  select * into v_profile from public.profiles profile where profile.id = v_user;
  if not found or v_profile.account_status <> 'active' or v_profile.public_uid is null then
    raise exception 'lottery_account_ineligible';
  end if;

  select draw.id into v_existing
  from public.reward_lottery_draws draw
  where draw.campaign_id = p_campaign_id and draw.user_id = v_user;
  if v_existing is not null then return public.reward_lottery_draw_payload(v_existing); end if;

  select * into v_campaign
  from public.reward_lottery_campaigns campaign
  where campaign.id = p_campaign_id
  for update;
  if not found or v_campaign.status <> 'active' then raise exception 'lottery_campaign_unavailable'; end if;
  if now() < v_campaign.starts_at or now() >= v_campaign.ends_at then raise exception 'lottery_campaign_not_open'; end if;

  insert into public.reward_wallets(user_id, balance, lifetime_earned)
  values (v_user, 0, 0)
  on conflict (user_id) do nothing;
  select wallet.balance into v_balance
  from public.reward_wallets wallet where wallet.user_id = v_user for update;
  if v_balance < v_campaign.entry_cost_points then raise exception 'lottery_balance_insufficient'; end if;

  v_bucket := public.reward_lottery_random_bucket();
  select candidate.id, candidate.campaign_id, candidate.name, candidate.summary,
    candidate.image_url, candidate.probability_bps, candidate.stock_total,
    candidate.stock_remaining, candidate.fulfillment_type, candidate.reward_points,
    candidate.sort_order, candidate.created_at, candidate.updated_at, candidate.upper_bound
  into v_prize.id, v_prize.campaign_id, v_prize.name, v_prize.summary,
    v_prize.image_url, v_prize.probability_bps, v_prize.stock_total,
    v_prize.stock_remaining, v_prize.fulfillment_type, v_prize.reward_points,
    v_prize.sort_order, v_prize.created_at, v_prize.updated_at, v_upper
  from (
    select prize.*,
      sum(prize.probability_bps) over (order by prize.sort_order, prize.created_at, prize.id)::integer as upper_bound
    from public.reward_lottery_prizes prize
    where prize.campaign_id = v_campaign.id
  ) candidate
  where v_bucket < candidate.upper_bound
    and v_bucket >= candidate.upper_bound - candidate.probability_bps
  order by candidate.sort_order, candidate.created_at, candidate.id
  limit 1;

  if v_prize.id is not null then
    update public.reward_lottery_prizes prize
    set stock_remaining = prize.stock_remaining - 1, updated_at = now()
    where prize.id = v_prize.id and prize.stock_remaining > 0
    returning true into v_won;
  end if;

  update public.reward_wallets
  set balance = balance - v_campaign.entry_cost_points, updated_at = now()
  where user_id = v_user
  returning balance into v_balance;
  insert into public.reward_ledger(user_id, action_key, reference_key, points, balance_after, note)
  values (v_user, 'lottery_entry', v_draw_id::text, -v_campaign.entry_cost_points, v_balance, '抽奖参与');

  if coalesce(v_won, false) then
    v_prize_snapshot := jsonb_build_object(
      'id', v_prize.id,
      'name', v_prize.name,
      'summary', v_prize.summary,
      'image_url', v_prize.image_url,
      'probability_bps', v_prize.probability_bps,
      'fulfillment_type', v_prize.fulfillment_type,
      'reward_points', v_prize.reward_points
    );
    if v_prize.fulfillment_type = 'points' then
      update public.reward_wallets
      set balance = balance + v_prize.reward_points,
          lifetime_earned = lifetime_earned + v_prize.reward_points,
          updated_at = now()
      where user_id = v_user
      returning balance into v_balance;
      insert into public.reward_ledger(user_id, action_key, reference_key, points, balance_after, note)
      values (v_user, 'lottery_prize', v_draw_id::text, v_prize.reward_points, v_balance, '抽奖积分奖励');
      v_fulfillment := 'fulfilled';
    else
      v_fulfillment := 'pending';
    end if;
  end if;

  insert into public.reward_lottery_draws(
    id, campaign_id, user_id, request_id, prize_id, outcome,
    campaign_snapshot, prize_snapshot, entry_cost_points, random_bucket,
    fulfillment_status, balance_after
  ) values (
    v_draw_id, v_campaign.id, v_user, p_request_id,
    case when coalesce(v_won, false) then v_prize.id else null end,
    case when coalesce(v_won, false) then 'won' else 'miss' end,
    jsonb_build_object(
      'id', v_campaign.id,
      'title', v_campaign.title,
      'entry_cost_points', v_campaign.entry_cost_points,
      'starts_at', v_campaign.starts_at,
      'ends_at', v_campaign.ends_at
    ),
    case when coalesce(v_won, false) then v_prize_snapshot else null end,
    v_campaign.entry_cost_points, v_bucket, v_fulfillment, v_balance
  );

  return public.reward_lottery_draw_payload(v_draw_id);
exception
  when unique_violation then
    select draw.id into v_existing
    from public.reward_lottery_draws draw
    where draw.campaign_id = p_campaign_id and draw.user_id = v_user;
    if v_existing is not null then return public.reward_lottery_draw_payload(v_existing); end if;
    raise;
end;
$$;

create or replace function public.admin_upsert_reward_lottery_campaign(
  p_id uuid,
  p_title text,
  p_description text,
  p_image_url text,
  p_entry_cost_points integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80
    or char_length(coalesce(p_description, '')) > 500
    or p_entry_cost_points is null or p_entry_cost_points not between 1 and 100000
    or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or (nullif(btrim(coalesce(p_image_url, '')), '') is not null and p_image_url !~ '^https://') then
    raise exception 'lottery_campaign_invalid';
  end if;

  if p_id is null then
    insert into public.reward_lottery_campaigns(
      title, description, image_url, entry_cost_points, starts_at, ends_at, created_by
    ) values (
      btrim(p_title), btrim(coalesce(p_description, '')), nullif(btrim(coalesce(p_image_url, '')), ''),
      p_entry_cost_points, p_starts_at, p_ends_at, v_admin
    ) returning id into v_id;
  else
    update public.reward_lottery_campaigns
    set title = btrim(p_title), description = btrim(coalesce(p_description, '')),
      image_url = nullif(btrim(coalesce(p_image_url, '')), ''), entry_cost_points = p_entry_cost_points,
      starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
    where id = p_id and status = 'draft'
    returning id into v_id;
    if v_id is null then raise exception 'lottery_campaign_not_editable'; end if;
  end if;

  insert into public.reward_lottery_admin_audit(admin_id, action, campaign_id, detail)
  values (v_admin, 'campaign_upserted', v_id, jsonb_build_object('title', btrim(p_title)));
  return v_id;
end;
$$;

create or replace function public.admin_upsert_reward_lottery_prize(
  p_id uuid,
  p_campaign_id uuid,
  p_name text,
  p_summary text,
  p_image_url text,
  p_probability_bps integer,
  p_stock_total integer,
  p_fulfillment_type text,
  p_reward_points integer,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  perform 1 from public.reward_lottery_campaigns campaign
    where campaign.id = p_campaign_id and campaign.status = 'draft' for update;
  if not found then raise exception 'lottery_campaign_not_editable'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80
    or char_length(coalesce(p_summary, '')) > 240
    or p_probability_bps is null or p_probability_bps not between 1 and 10000
    or p_stock_total is null or p_stock_total < 0
    or p_fulfillment_type not in ('points', 'manual')
    or (p_fulfillment_type = 'points' and coalesce(p_reward_points, 0) <= 0)
    or (p_fulfillment_type = 'manual' and p_reward_points is not null)
    or (nullif(btrim(coalesce(p_image_url, '')), '') is not null and p_image_url !~ '^https://') then
    raise exception 'lottery_prize_invalid';
  end if;

  insert into public.reward_lottery_prizes(
    id, campaign_id, name, summary, image_url, probability_bps,
    stock_total, stock_remaining, fulfillment_type, reward_points, sort_order
  ) values (
    coalesce(p_id, gen_random_uuid()), p_campaign_id, btrim(p_name), btrim(coalesce(p_summary, '')),
    nullif(btrim(coalesce(p_image_url, '')), ''), p_probability_bps, p_stock_total, p_stock_total,
    p_fulfillment_type, p_reward_points, coalesce(p_sort_order, 100)
  )
  on conflict (id) do update set
    name = excluded.name, summary = excluded.summary, image_url = excluded.image_url,
    probability_bps = excluded.probability_bps, stock_total = excluded.stock_total,
    stock_remaining = excluded.stock_total, fulfillment_type = excluded.fulfillment_type,
    reward_points = excluded.reward_points, sort_order = excluded.sort_order, updated_at = now()
  where public.reward_lottery_prizes.campaign_id = excluded.campaign_id
  returning id into v_id;
  if v_id is null then raise exception 'lottery_prize_not_editable'; end if;

  insert into public.reward_lottery_admin_audit(admin_id, action, campaign_id, prize_id, detail)
  values (v_admin, 'prize_upserted', p_campaign_id, v_id, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.admin_set_reward_lottery_campaign_status(p_campaign_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_campaign public.reward_lottery_campaigns%rowtype;
  v_probability integer;
  v_prize_count integer;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('active', 'closed') then raise exception 'lottery_status_invalid'; end if;
  select * into v_campaign from public.reward_lottery_campaigns campaign
    where campaign.id = p_campaign_id for update;
  if not found then raise exception 'lottery_campaign_not_found'; end if;

  if p_status = 'active' then
    if v_campaign.status <> 'draft' or v_campaign.ends_at <= now() then
      raise exception 'lottery_campaign_not_activatable';
    end if;
    select count(*)::integer, coalesce(sum(prize.probability_bps), 0)::integer
      into v_prize_count, v_probability
    from public.reward_lottery_prizes prize where prize.campaign_id = p_campaign_id;
    if v_prize_count = 0 or v_probability < 1 or v_probability > 10000 then
      raise exception 'lottery_configuration_invalid';
    end if;
    if exists (select 1 from public.reward_lottery_campaigns other where other.status = 'active' and other.id <> p_campaign_id) then
      raise exception 'lottery_campaign_conflict';
    end if;
    update public.reward_lottery_campaigns
      set status = 'active', activated_at = now(), updated_at = now()
      where id = p_campaign_id;
  else
    if v_campaign.status = 'closed' then return; end if;
    update public.reward_lottery_campaigns
      set status = 'closed', closed_at = now(), updated_at = now()
      where id = p_campaign_id;
  end if;

  insert into public.reward_lottery_admin_audit(admin_id, action, campaign_id, detail)
  values (v_admin, 'campaign_status_changed', p_campaign_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_get_reward_lottery()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  return jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(campaign) order by campaign.created_at desc)
      from public.reward_lottery_campaigns campaign
    ), '[]'::jsonb),
    'prizes', coalesce((
      select jsonb_agg(to_jsonb(prize) order by prize.campaign_id, prize.sort_order, prize.created_at)
      from public.reward_lottery_prizes prize
    ), '[]'::jsonb),
    'draws', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', draw.id,
        'campaign_id', draw.campaign_id,
        'user_id', draw.user_id,
        'public_uid', profile.public_uid,
        'outcome', draw.outcome,
        'prize', draw.prize_snapshot,
        'entry_cost_points', draw.entry_cost_points,
        'fulfillment_status', draw.fulfillment_status,
        'fulfillment_note', draw.fulfillment_note,
        'created_at', draw.created_at,
        'fulfilled_at', draw.fulfilled_at
      ) order by draw.created_at desc)
      from public.reward_lottery_draws draw
      join public.profiles profile on profile.id = draw.user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_fulfill_reward_lottery_draw(p_draw_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_campaign uuid;
  v_prize uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'lottery_fulfillment_note_required'; end if;
  update public.reward_lottery_draws draw
    set fulfillment_status = 'fulfilled', fulfillment_note = btrim(p_note),
      fulfilled_by = v_admin, fulfilled_at = now(), updated_at = now()
    where draw.id = p_draw_id and draw.outcome = 'won' and draw.fulfillment_status = 'pending'
    returning draw.campaign_id, draw.prize_id into v_campaign, v_prize;
  if v_campaign is null then raise exception 'lottery_draw_not_pending'; end if;
  insert into public.reward_lottery_admin_audit(admin_id, action, campaign_id, prize_id, draw_id, detail)
  values (v_admin, 'draw_fulfilled', v_campaign, v_prize, p_draw_id, jsonb_build_object('note', btrim(p_note)));
end;
$$;

revoke all on function public.reward_lottery_random_bucket() from public, anon, authenticated;
revoke all on function public.reward_lottery_draw_payload(uuid) from public, anon, authenticated;
revoke all on function public.get_my_reward_lottery() from public, anon, authenticated;
revoke all on function public.draw_reward_lottery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_upsert_reward_lottery_campaign(uuid, text, text, text, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_upsert_reward_lottery_prize(uuid, uuid, text, text, text, integer, integer, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_set_reward_lottery_campaign_status(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_get_reward_lottery() from public, anon, authenticated;
revoke all on function public.admin_fulfill_reward_lottery_draw(uuid, text) from public, anon, authenticated;

grant execute on function public.get_my_reward_lottery() to authenticated;
grant execute on function public.draw_reward_lottery(uuid, uuid) to authenticated;
grant execute on function public.admin_upsert_reward_lottery_campaign(uuid, text, text, text, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_upsert_reward_lottery_prize(uuid, uuid, text, text, text, integer, integer, text, integer, integer) to authenticated;
grant execute on function public.admin_set_reward_lottery_campaign_status(uuid, text) to authenticated;
grant execute on function public.admin_get_reward_lottery() to authenticated;
grant execute on function public.admin_fulfill_reward_lottery_draw(uuid, text) to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202609090002'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
