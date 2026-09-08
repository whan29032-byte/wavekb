begin;

-- Hold snapshot writers until both the historical backfill and the insert
-- trigger are ready, so no synchronization can fall between them.
lock table public.trading_equity_snapshots in share row exclusive mode;

-- Maintain a constant-size aggregate per connection. The initial baseline
-- snapshot counts as a sample but contributes a neutral factor of 1.
create table if not exists public.trading_return_summaries (
  connection_id uuid primary key references public.exchange_connections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  return_factor numeric not null default 1 check (return_factor > 0),
  sample_count bigint not null default 0 check (sample_count >= 0),
  updated_at timestamptz not null
);

alter table public.trading_return_summaries enable row level security;
revoke all on table public.trading_return_summaries from public, anon, authenticated;

-- Backfill once for connections created before this migration. Re-running the
-- migration remains safe because the aggregate is rebuilt from source data.
insert into public.trading_return_summaries (
  connection_id,
  owner_id,
  return_factor,
  sample_count,
  updated_at
)
select
  connection.id,
  connection.owner_id,
  coalesce(
    exp(sum(ln(greatest(1 + snapshot.period_return, 0.000001)))
      filter (where snapshot.period_return is not null)),
    1
  ),
  count(snapshot.id),
  coalesce(max(snapshot.captured_at), connection.started_at)
from public.exchange_connections connection
left join public.trading_equity_snapshots snapshot
  on snapshot.connection_id = connection.id
group by connection.id
on conflict (connection_id) do update
set owner_id = excluded.owner_id,
    return_factor = excluded.return_factor,
    sample_count = excluded.sample_count,
    updated_at = excluded.updated_at;

create or replace function public.accumulate_trading_return_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_factor numeric;
begin
  snapshot_factor := case
    when new.period_return is null then 1
    else greatest(1 + new.period_return, 0.000001)
  end;

  insert into public.trading_return_summaries as summary (
    connection_id,
    owner_id,
    return_factor,
    sample_count,
    updated_at
  ) values (
    new.connection_id,
    new.owner_id,
    snapshot_factor,
    1,
    new.captured_at
  )
  on conflict (connection_id) do update
  set owner_id = excluded.owner_id,
      return_factor = summary.return_factor * excluded.return_factor,
      sample_count = summary.sample_count + 1,
      updated_at = greatest(summary.updated_at, excluded.updated_at);

  return new;
end;
$$;

revoke all on function public.accumulate_trading_return_summary() from public, anon, authenticated;

drop trigger if exists trading_equity_snapshots_summarize on public.trading_equity_snapshots;
create trigger trading_equity_snapshots_summarize
after insert on public.trading_equity_snapshots
for each row execute function public.accumulate_trading_return_summary();

-- Keep the deployed RPC signature for compatibility. The period input is now
-- ignored because every result covers the connection's full lifetime.
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
  sample_count bigint,
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
      summary.sample_count,
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
    ranked.sample_count,
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
  select '202609080002'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

commit;
