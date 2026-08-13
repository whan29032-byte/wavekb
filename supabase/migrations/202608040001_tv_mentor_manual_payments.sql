begin;

alter table public.posts
  add column if not exists chart_package jsonb;

create table if not exists public.mentor_payment_methods (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.mentor_profiles(id) on delete cascade,
  kind text not null check (kind in ('alipay', 'wechat', 'bank', 'binance', 'crypto', 'other')),
  label text not null check (char_length(label) between 2 and 60),
  account_name text not null default '',
  account_value text not null check (char_length(account_value) between 2 and 240),
  network text not null default '',
  instructions text not null default '',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mentor_orders
  add column if not exists payment_method_id uuid references public.mentor_payment_methods(id) on delete set null;

create table if not exists public.mentor_payment_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.mentor_orders(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  mentor_id uuid not null references public.mentor_profiles(id) on delete restrict,
  payment_method_id uuid references public.mentor_payment_methods(id) on delete set null,
  buyer_note text not null default '' check (char_length(buyer_note) <= 1000),
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'rejected', 'cancelled')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete set null
);

create index if not exists mentor_payment_methods_catalog_idx
  on public.mentor_payment_methods(mentor_id, active, sort_order);
create index if not exists mentor_payment_claims_mentor_idx
  on public.mentor_payment_claims(mentor_id, status, submitted_at desc);

alter table public.mentor_payment_methods enable row level security;
alter table public.mentor_payment_claims enable row level security;

drop policy if exists mentor_payment_methods_catalog_read on public.mentor_payment_methods;
create policy mentor_payment_methods_catalog_read
on public.mentor_payment_methods for select
using (
  active
  or public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
);

drop policy if exists mentor_payment_methods_owner_write on public.mentor_payment_methods;
create policy mentor_payment_methods_owner_write
on public.mentor_payment_methods for all
using (
  public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
)
with check (
  public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
);

drop policy if exists mentor_offers_owner_write on public.mentor_offers;
create policy mentor_offers_owner_write
on public.mentor_offers for all
using (
  public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
)
with check (
  public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
);

drop policy if exists mentor_payment_claims_participant_read on public.mentor_payment_claims;
create policy mentor_payment_claims_participant_read
on public.mentor_payment_claims for select
using (
  buyer_id = auth.uid()
  or public.mentor_is_admin()
  or exists (
    select 1 from public.mentor_profiles profile
    where profile.id = mentor_id and profile.owner_id = auth.uid()
  )
);

create or replace function public.list_mentor_payment_methods(p_mentor_id uuid)
returns table (
  id uuid,
  kind text,
  label text,
  account_name text,
  account_value text,
  network text,
  instructions text
)
language sql
stable
security definer
set search_path = public
as $$
  select method.id, method.kind, method.label, method.account_name,
    method.account_value, method.network, method.instructions
  from public.mentor_payment_methods method
  join public.mentor_profiles mentor on mentor.id = method.mentor_id
  where method.mentor_id = p_mentor_id
    and method.active
    and mentor.active
  order by method.sort_order, method.created_at;
$$;

create or replace function public.get_my_mentor_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when mentor.id is null then null else jsonb_build_object(
    'profile', to_jsonb(mentor),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(offer) order by offer.sort_order, offer.created_at)
      from public.mentor_offers offer where offer.mentor_id = mentor.id
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(to_jsonb(method) order by method.sort_order, method.created_at)
      from public.mentor_payment_methods method where method.mentor_id = mentor.id
    ), '[]'::jsonb)
  ) end
  from (select 1) seed
  left join public.mentor_profiles mentor on mentor.owner_id = auth.uid();
$$;

create or replace function public.create_manual_mentor_order(
  p_offer_id uuid,
  p_payment_method_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_offer public.mentor_offers%rowtype;
  selected_method public.mentor_payment_methods%rowtype;
  order_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into selected_offer from public.mentor_offers
    where id = p_offer_id and active;
  select * into selected_method from public.mentor_payment_methods
    where id = p_payment_method_id and active;
  if selected_offer.id is null then raise exception 'offer_unavailable'; end if;
  if selected_method.id is null or selected_method.mentor_id <> selected_offer.mentor_id then
    raise exception 'payment_method_unavailable';
  end if;
  insert into public.mentor_orders (
    buyer_id, mentor_id, offer_id, amount_cents, currency,
    payment_provider, payment_method_id
  ) values (
    auth.uid(), selected_offer.mentor_id, selected_offer.id,
    selected_offer.price_cents, upper(selected_offer.currency),
    'manual', selected_method.id
  ) returning id into order_id;
  return order_id;
end;
$$;

create or replace function public.submit_mentor_payment_claim(
  p_order_id uuid,
  p_buyer_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_order public.mentor_orders%rowtype;
  claim_id uuid;
begin
  select * into selected_order from public.mentor_orders where id = p_order_id;
  if selected_order.id is null or selected_order.buyer_id <> auth.uid() then
    raise exception 'order_access_denied';
  end if;
  if selected_order.status <> 'pending' then raise exception 'order_not_pending'; end if;
  insert into public.mentor_payment_claims (
    order_id, buyer_id, mentor_id, payment_method_id, buyer_note
  ) values (
    selected_order.id, selected_order.buyer_id, selected_order.mentor_id,
    selected_order.payment_method_id, left(btrim(coalesce(p_buyer_note, '')), 1000)
  )
  on conflict (order_id) do update set
    buyer_note = excluded.buyer_note,
    status = 'submitted',
    submitted_at = now(),
    reviewed_at = null,
    reviewer_id = null
  returning id into claim_id;
  return claim_id;
end;
$$;

create or replace function public.list_my_mentor_payment_claims()
returns table (
  claim_id uuid,
  order_id uuid,
  buyer_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  offer_name text,
  amount_cents integer,
  currency text,
  payment_label text,
  buyer_note text,
  status text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select claim.id, claim.order_id, claim.buyer_id, buyer.public_uid,
    buyer.display_name, buyer.avatar_url, offer.name, order_row.amount_cents,
    order_row.currency, method.label, claim.buyer_note, claim.status, claim.submitted_at
  from public.mentor_payment_claims claim
  join public.mentor_profiles mentor on mentor.id = claim.mentor_id
  join public.mentor_orders order_row on order_row.id = claim.order_id
  join public.mentor_offers offer on offer.id = order_row.offer_id
  join public.profiles buyer on buyer.id = claim.buyer_id
  left join public.mentor_payment_methods method on method.id = claim.payment_method_id
  where mentor.owner_id = auth.uid()
  order by (claim.status = 'submitted') desc, claim.submitted_at desc;
$$;

create or replace function public.review_mentor_payment_claim(
  p_claim_id uuid,
  p_confirm boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_claim public.mentor_payment_claims%rowtype;
  thread_id uuid;
begin
  select claim.* into selected_claim
  from public.mentor_payment_claims claim
  join public.mentor_profiles mentor on mentor.id = claim.mentor_id
  where claim.id = p_claim_id
    and mentor.owner_id = auth.uid()
  for update;
  if selected_claim.id is null then raise exception 'claim_access_denied'; end if;
  if selected_claim.status <> 'submitted' then raise exception 'claim_already_reviewed'; end if;

  update public.mentor_payment_claims set
    status = case when p_confirm then 'confirmed' else 'rejected' end,
    reviewed_at = now(), reviewer_id = auth.uid()
  where id = selected_claim.id;

  if p_confirm then
    update public.mentor_orders set status = 'paid', paid_at = now(), updated_at = now()
    where id = selected_claim.order_id and status = 'pending';
    select thread.id into thread_id
    from public.mentor_threads thread
    join public.mentor_entitlements entitlement on entitlement.id = thread.entitlement_id
    where entitlement.order_id = selected_claim.order_id;
  end if;
  return thread_id;
end;
$$;

create or replace function public.admin_list_mentor_catalog_v2()
returns table (
  id uuid,
  owner_id uuid,
  display_name text,
  headline text,
  bio text,
  avatar_url text,
  specialties text[],
  credentials text[],
  languages text[],
  verification_label text,
  active boolean,
  sort_order integer,
  mentor_offers jsonb,
  payment_methods jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.owner_id, m.display_name, m.headline, m.bio, m.avatar_url,
    m.specialties, m.credentials, m.languages, m.verification_label,
    m.active, m.sort_order,
    coalesce((select jsonb_agg(to_jsonb(o) order by o.sort_order, o.created_at)
      from public.mentor_offers o where o.mentor_id = m.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(method) order by method.sort_order, method.created_at)
      from public.mentor_payment_methods method where method.mentor_id = m.id), '[]'::jsonb)
  from public.mentor_profiles m
  where public.mentor_is_admin()
  order by m.sort_order, m.created_at;
$$;

revoke all on function public.list_mentor_payment_methods(uuid) from public;
revoke all on function public.get_my_mentor_settings() from public;
revoke all on function public.create_manual_mentor_order(uuid, uuid) from public;
revoke all on function public.submit_mentor_payment_claim(uuid, text) from public;
revoke all on function public.list_my_mentor_payment_claims() from public;
revoke all on function public.review_mentor_payment_claim(uuid, boolean) from public;
revoke all on function public.admin_list_mentor_catalog_v2() from public;
grant execute on function public.list_mentor_payment_methods(uuid) to anon, authenticated;
grant execute on function public.get_my_mentor_settings() to authenticated;
grant execute on function public.create_manual_mentor_order(uuid, uuid) to authenticated;
grant execute on function public.submit_mentor_payment_claim(uuid, text) to authenticated;
grant execute on function public.list_my_mentor_payment_claims() to authenticated;
grant execute on function public.review_mentor_payment_claim(uuid, boolean) to authenticated;
grant execute on function public.admin_list_mentor_catalog_v2() to authenticated;
grant select, insert, update, delete on public.mentor_payment_methods to authenticated;
grant select on public.mentor_payment_claims to authenticated;

commit;
