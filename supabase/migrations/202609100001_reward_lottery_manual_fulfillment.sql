begin;

-- The final product rule is intentionally simple: every winning prize is
-- fulfilled by an administrator. Convert any draft configuration created
-- with the earlier points option before enforcing that invariant.
lock table public.reward_lottery_prizes in share row exclusive mode;

update public.reward_lottery_prizes
set fulfillment_type = 'manual',
    reward_points = null,
    updated_at = now()
where fulfillment_type <> 'manual'
   or reward_points is not null;

alter table public.reward_lottery_prizes
  drop constraint if exists reward_lottery_prizes_manual_fulfillment_check;

alter table public.reward_lottery_prizes
  add constraint reward_lottery_prizes_manual_fulfillment_check
  check (fulfillment_type = 'manual' and reward_points is null);

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202609100001'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
