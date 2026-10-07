begin;

alter table public.exchange_connections
  add column if not exists public_display_equity_usdt numeric(30, 8);

alter table public.exchange_connections
  drop constraint if exists exchange_connections_public_display_equity_check;
alter table public.exchange_connections
  add constraint exchange_connections_public_display_equity_check
  check (public_display_equity_usdt is null or public_display_equity_usdt >= 0);

alter table public.user_moderation_audit
  drop constraint if exists user_moderation_audit_action_check;
alter table public.user_moderation_audit
  add constraint user_moderation_audit_action_check check (
    action in (
      'ban', 'unban', 'mute', 'unmute', 'grant_admin', 'revoke_admin',
      'set_uid', 'disable_exchange', 'set_display_equity'
    )
  );

create or replace function public.admin_set_exchange_display_equity(
  p_actor uuid,
  p_connection_id uuid,
  p_display_equity_usdt numeric,
  p_reason text
)
returns public.exchange_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection public.exchange_connections;
  previous jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and role = 'admin' and account_status = 'active'
  ) then raise exception 'admin_required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'reason_required';
  end if;
  if p_display_equity_usdt is not null and p_display_equity_usdt < 0 then
    raise exception 'invalid_display_equity';
  end if;

  select * into connection
  from public.exchange_connections
  where id = p_connection_id
  for update;
  if connection.id is null then raise exception 'exchange_connection_not_found'; end if;
  previous := to_jsonb(connection);

  update public.exchange_connections
  set public_display_equity_usdt = p_display_equity_usdt
  where id = p_connection_id
  returning * into connection;

  insert into public.user_moderation_audit (
    actor_id, target_id, action, reason, before_state, after_state
  ) values (
    p_actor, connection.owner_id, 'set_display_equity', trim(p_reason),
    previous, to_jsonb(connection)
  );
  return connection;
end;
$$;

revoke all on function public.admin_set_exchange_display_equity(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_set_exchange_display_equity(uuid, uuid, numeric, text) to service_role;

create or replace function public.list_trading_leaderboard(
  p_period text default 'realtime',
  p_limit integer default 50
)
returns table (
  rank_no bigint,
  user_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  display_title text,
  nameplate_style text,
  return_rate numeric,
  current_equity_usdt text,
  cumulative_profit_usdt text,
  tracking_started_at timestamptz,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      profile.id as user_id,
      profile.public_uid,
      profile.display_name,
      profile.avatar_url,
      profile.display_title,
      profile.nameplate_style,
      summary.return_factor - 1 as return_rate,
      coalesce(connection.public_display_equity_usdt, summary.current_equity_usdt) as current_equity_usdt,
      summary.cumulative_profit_usdt,
      connection.started_at,
      connection.last_synced_at
    from public.exchange_connections connection
    join public.trading_return_summaries summary
      on summary.connection_id = connection.id
    join public.profiles profile on profile.id = connection.owner_id
    where profile.public_uid is not null
      and profile.account_status = 'active'
      and connection.status in ('active', 'error')
      and connection.public_enabled
      and connection.public_amounts_consented_at is not null
      and connection.last_synced_at >= now() - interval '6 hours'
      and not (
        connection.status = 'error'
        and connection.last_error_code in (
          'binance_multi_asset_not_supported',
          'binance_transfer_asset_not_supported',
          'binance_income_window_too_large',
          'exchange_sync_gap_too_large'
        )
      )
  )
  select
    row_number() over (order by ranked.return_rate desc, ranked.started_at asc),
    ranked.user_id,
    ranked.public_uid,
    ranked.display_name,
    ranked.avatar_url,
    ranked.display_title,
    ranked.nameplate_style,
    ranked.return_rate,
    ranked.current_equity_usdt::text,
    ranked.cumulative_profit_usdt::text,
    ranked.started_at,
    ranked.last_synced_at
  from ranked
  order by ranked.return_rate desc, ranked.started_at asc
  limit least(greatest(coalesce(p_limit, 50), 3), 100);
$$;

revoke all on function public.list_trading_leaderboard(text, integer) from public;
grant execute on function public.list_trading_leaderboard(text, integer) to anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202610080001'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
