begin;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    join auth.users on auth.users.id = profiles.id
    where profiles.id = auth.uid()
      and profiles.public_uid is not null
      and profiles.account_status = 'active'
      and auth.users.email_confirmed_at is not null
  );
$$;

revoke all on function public.account_is_active() from public, anon;
grant execute on function public.account_is_active() to authenticated;

create or replace function public.enforce_active_account_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.account_is_active() then
    raise exception 'account_banned';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_participation_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.can_participate() then
    raise exception 'participation_restricted';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_active_account_write() from public, anon, authenticated;
revoke all on function public.enforce_participation_write() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'private_entries', 'private_entry_images', 'workbench_analyses',
    'chat_stickers', 'reward_daily_checkins', 'reward_redemptions',
    'mentor_orders', 'mentor_payment_claims'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists enforce_active_account_write on public.%I', table_name);
      execute format(
        'create trigger enforce_active_account_write before insert or update on public.%I for each row execute function public.enforce_active_account_write()',
        table_name
      );
    end if;
  end loop;

  foreach table_name in array array[
    'friendships', 'direct_conversations', 'direct_messages',
    'profile_follows', 'mentor_messages'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists enforce_participation_write on public.%I', table_name);
      execute format(
        'create trigger enforce_participation_write before insert or update on public.%I for each row execute function public.enforce_participation_write()',
        table_name
      );
    end if;
  end loop;
end;
$$;

commit;
