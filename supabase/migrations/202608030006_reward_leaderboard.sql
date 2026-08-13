begin;

create or replace function public.list_reward_leaderboard(p_limit integer default 20)
returns table (
  rank_no bigint,
  user_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  display_title text,
  nameplate_style text,
  balance integer,
  lifetime_earned integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    row_number() over (
      order by coalesce(wallet.lifetime_earned, 0) desc,
               coalesce(wallet.balance, 0) desc,
               profile.created_at asc
    ) as rank_no,
    profile.id,
    profile.public_uid,
    profile.display_name,
    profile.avatar_url,
    profile.display_title,
    profile.nameplate_style,
    coalesce(wallet.balance, 0),
    coalesce(wallet.lifetime_earned, 0)
  from public.profiles profile
  join public.reward_wallets wallet on wallet.user_id = profile.id
  where auth.uid() is not null
    and profile.public_uid is not null
  order by coalesce(wallet.lifetime_earned, 0) desc,
           coalesce(wallet.balance, 0) desc,
           profile.created_at asc
  limit least(greatest(coalesce(p_limit, 20), 3), 50);
$$;

revoke all on function public.list_reward_leaderboard(integer) from public;
grant execute on function public.list_reward_leaderboard(integer) to authenticated;

commit;
