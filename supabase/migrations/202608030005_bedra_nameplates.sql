begin;

create table if not exists public.user_nameplates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.reward_products(id) on delete cascade,
  style text not null check (style in ('blackgold', 'rainbow', 'newyear', 'platinum', 'purplegold')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  equipped boolean not null default false,
  source text not null default 'redeemed' check (source in ('redeemed', 'admin_grant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create unique index if not exists user_nameplates_one_equipped_idx
  on public.user_nameplates(user_id) where equipped;
create index if not exists user_nameplates_owner_expiry_idx
  on public.user_nameplates(user_id, expires_at desc);

alter table public.user_nameplates enable row level security;
drop policy if exists user_nameplates_owner_read on public.user_nameplates;
create policy user_nameplates_owner_read on public.user_nameplates
for select to authenticated using (user_id = auth.uid() or public.mentor_is_admin());

create or replace function public.sync_member_nameplate(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_style text := 'classic';
begin
  update public.user_nameplates
  set equipped = false, updated_at = now()
  where user_id = p_user and equipped and expires_at <= now();

  select n.style into v_style
  from public.user_nameplates n
  where n.user_id = p_user and n.equipped and n.expires_at > now()
  order by n.updated_at desc limit 1;

  v_style := coalesce(v_style, 'classic');
  update public.profiles
  set nameplate_style = v_style, updated_at = now()
  where id = p_user and coalesce(nameplate_style, 'classic') <> v_style;
  return v_style;
end;
$$;

create or replace function public.get_my_reward_center()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  perform public.ensure_reward_wallet(v_user);
  perform public.sync_member_nameplate(v_user);
  select jsonb_build_object(
    'wallet', jsonb_build_object(
      'balance', coalesce(w.balance, 0),
      'lifetime_earned', coalesce(w.lifetime_earned, 0)
    ),
    'checked_today', exists (
      select 1 from public.reward_daily_checkins c
      where c.user_id = v_user and c.checkin_date = current_date
    ),
    'streak', coalesce((
      select c.streak from public.reward_daily_checkins c
      where c.user_id = v_user order by c.checkin_date desc limit 1
    ), 0),
    'products', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at)
      from public.reward_products p where p.active and p.stock <> 0
    ), '[]'::jsonb),
    'nameplates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'product_id', n.product_id, 'product_name', p.name,
        'style', n.style, 'starts_at', n.starts_at, 'expires_at', n.expires_at,
        'equipped', n.equipped, 'source', n.source
      ) order by n.equipped desc, n.expires_at desc)
      from public.user_nameplates n
      join public.reward_products p on p.id = n.product_id
      where n.user_id = v_user and n.expires_at > now()
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(rows) order by rows.created_at desc)
      from (
        select l.id, l.action_key, l.points, l.balance_after, l.note, l.created_at
        from public.reward_ledger l where l.user_id = v_user
        order by l.created_at desc limit 20
      ) rows
    ), '[]'::jsonb)
  ) into v_result
  from public.reward_wallets w where w.user_id = v_user;
  return v_result;
end;
$$;

create or replace function public.redeem_reward_product(p_product uuid, p_quantity integer default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_product public.reward_products%rowtype;
  v_wallet public.reward_wallets%rowtype;
  v_redemption uuid := gen_random_uuid();
  v_cost integer;
  v_balance integer;
  v_status text := 'pending';
  v_style text;
  v_title text;
  v_duration integer;
  v_entitlement uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_quantity not between 1 and 20 then raise exception 'quantity_invalid'; end if;
  select * into v_product from public.reward_products where id = p_product and active for update;
  if not found or v_product.stock = 0 then raise exception 'product_unavailable'; end if;
  if v_product.product_type = 'nameplate' and p_quantity <> 1 then raise exception 'nameplate_quantity_invalid'; end if;
  v_cost := v_product.price_points * p_quantity;
  select * into v_wallet from public.ensure_reward_wallet(v_user);
  if v_wallet.balance < v_cost then raise exception 'reward_balance_insufficient'; end if;
  if v_product.stock > 0 and v_product.stock < p_quantity then raise exception 'product_stock_insufficient'; end if;

  update public.reward_wallets set balance = balance - v_cost, updated_at = now()
  where user_id = v_user returning balance into v_balance;
  insert into public.reward_ledger(user_id, action_key, reference_key, points, balance_after, note)
  values (v_user, 'product_redeemed', v_redemption::text, -v_cost, v_balance, '兑换：' || v_product.name);
  if v_product.stock > 0 then
    update public.reward_products set stock = stock - p_quantity, updated_at = now() where id = v_product.id;
  end if;

  if v_product.product_type = 'nameplate' then
    v_style := coalesce(v_product.metadata->>'nameplate_style', 'blackgold');
    if v_style not in ('blackgold', 'rainbow', 'newyear', 'platinum', 'purplegold') then
      raise exception 'nameplate_style_invalid';
    end if;
    v_duration := greatest(1, least(3650, coalesce((v_product.metadata->>'duration_days')::integer, 30)));
    update public.user_nameplates set equipped = false, updated_at = now()
    where user_id = v_user and equipped;
    insert into public.user_nameplates(user_id, product_id, style, expires_at, equipped, source)
    values (v_user, v_product.id, v_style, now() + make_interval(days => v_duration), true, 'redeemed')
    on conflict (user_id, product_id) do update set
      style = excluded.style,
      starts_at = case when public.user_nameplates.expires_at <= now() then now() else public.user_nameplates.starts_at end,
      expires_at = greatest(public.user_nameplates.expires_at, now()) + make_interval(days => v_duration),
      equipped = true,
      source = 'redeemed',
      updated_at = now()
    returning id into v_entitlement;
    update public.profiles set nameplate_style = v_style, updated_at = now() where id = v_user;
    v_status := 'fulfilled';
  elsif v_product.product_type = 'title' then
    v_title := left(trim(coalesce(v_product.metadata->>'display_title', '')), 24);
    if v_title = '' then raise exception 'display_title_invalid'; end if;
    update public.profiles set display_title = v_title, updated_at = now() where id = v_user;
    v_status := 'fulfilled';
  end if;

  insert into public.reward_redemptions(id, user_id, product_id, quantity, points_spent, status)
  values (v_redemption, v_user, v_product.id, p_quantity, v_cost, v_status);
  return jsonb_build_object(
    'redemption_id', v_redemption, 'entitlement_id', v_entitlement,
    'status', v_status, 'balance', v_balance
  );
end;
$$;

create or replace function public.equip_my_nameplate(p_entitlement uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_plate public.user_nameplates%rowtype;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select * into v_plate from public.user_nameplates
  where id = p_entitlement and user_id = v_user for update;
  if not found then raise exception 'nameplate_not_found'; end if;
  if v_plate.expires_at <= now() then raise exception 'nameplate_expired'; end if;
  update public.user_nameplates set equipped = false, updated_at = now()
  where user_id = v_user and equipped;
  update public.user_nameplates set equipped = true, updated_at = now() where id = v_plate.id;
  update public.profiles set nameplate_style = v_plate.style, updated_at = now() where id = v_user;
  return jsonb_build_object('equipped', true, 'style', v_plate.style, 'expires_at', v_plate.expires_at);
end;
$$;

create or replace function public.admin_list_nameplate_entitlements()
returns table (
  id uuid, user_id uuid, public_uid integer, display_name text,
  product_id uuid, product_name text, style text, starts_at timestamptz,
  expires_at timestamptz, equipped boolean, source text
)
language sql stable security definer set search_path = public as $$
  select n.id, n.user_id, u.public_uid, u.display_name, n.product_id,
    p.name, n.style, n.starts_at, n.expires_at, n.equipped, n.source
  from public.user_nameplates n
  join public.profiles u on u.id = n.user_id
  join public.reward_products p on p.id = n.product_id
  where public.mentor_is_admin()
  order by n.equipped desc, n.expires_at desc limit 2000;
$$;

create or replace function public.admin_grant_nameplate(
  p_user uuid, p_product uuid, p_duration_days integer default 30, p_equip boolean default true
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_product public.reward_products%rowtype;
  v_style text;
  v_id uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_duration_days not between 1 and 3650 then raise exception 'duration_invalid'; end if;
  select * into v_product from public.reward_products where id = p_product and product_type = 'nameplate';
  if not found then raise exception 'nameplate_product_not_found'; end if;
  v_style := coalesce(v_product.metadata->>'nameplate_style', '');
  if v_style not in ('blackgold', 'rainbow', 'newyear', 'platinum', 'purplegold') then
    raise exception 'nameplate_style_invalid';
  end if;
  if p_equip then
    update public.user_nameplates set equipped = false, updated_at = now()
    where user_id = p_user and equipped;
  end if;
  insert into public.user_nameplates(user_id, product_id, style, expires_at, equipped, source)
  values (p_user, p_product, v_style, now() + make_interval(days => p_duration_days), p_equip, 'admin_grant')
  on conflict (user_id, product_id) do update set
    style = excluded.style,
    starts_at = case when public.user_nameplates.expires_at <= now() then now() else public.user_nameplates.starts_at end,
    expires_at = greatest(public.user_nameplates.expires_at, now()) + make_interval(days => p_duration_days),
    equipped = case when p_equip then true else public.user_nameplates.equipped end,
    source = 'admin_grant',
    updated_at = now()
  returning id into v_id;
  if p_equip then
    update public.profiles set nameplate_style = v_style, updated_at = now() where id = p_user;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_revoke_nameplate(p_entitlement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  delete from public.user_nameplates where id = p_entitlement returning user_id into v_user;
  if v_user is null then raise exception 'nameplate_not_found'; end if;
  perform public.sync_member_nameplate(v_user);
end;
$$;

create or replace function public.admin_update_member_profile(
  p_user uuid, p_display_name text, p_bio text default '',
  p_display_title text default '', p_nameplate_style text default 'classic'
)
returns void language plpgsql security definer set search_path = public as $$
declare v_product uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_user is null or char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'display_name_invalid';
  end if;
  if char_length(coalesce(p_bio, '')) > 200 or char_length(coalesce(p_display_title, '')) > 24 then
    raise exception 'profile_value_invalid';
  end if;
  if p_nameplate_style not in ('classic', 'blackgold', 'platinum', 'purplegold', 'rainbow', 'newyear') then
    raise exception 'nameplate_style_invalid';
  end if;
  if p_nameplate_style = 'classic' then
    update public.user_nameplates set equipped = false, updated_at = now()
    where user_id = p_user and equipped;
  else
    select id into v_product from public.reward_products
    where product_type = 'nameplate' and metadata->>'nameplate_style' = p_nameplate_style
    order by active desc, sort_order limit 1;
    if v_product is null then raise exception 'nameplate_product_not_found'; end if;
    update public.user_nameplates set equipped = false, updated_at = now()
    where user_id = p_user and equipped;
    insert into public.user_nameplates(user_id, product_id, style, expires_at, equipped, source)
    values (p_user, v_product, p_nameplate_style, now() + interval '3650 days', true, 'admin_grant')
    on conflict (user_id, product_id) do update set
      style = excluded.style,
      expires_at = greatest(public.user_nameplates.expires_at, excluded.expires_at),
      equipped = true,
      source = 'admin_grant',
      updated_at = now();
  end if;
  update public.profiles
  set display_name = trim(p_display_name), bio = trim(coalesce(p_bio, '')),
      display_title = nullif(trim(coalesce(p_display_title, '')), ''),
      nameplate_style = p_nameplate_style, updated_at = now()
  where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
end;
$$;

revoke all on function public.sync_member_nameplate(uuid) from public;
revoke all on function public.equip_my_nameplate(uuid) from public;
revoke all on function public.admin_list_nameplate_entitlements() from public;
revoke all on function public.admin_grant_nameplate(uuid, uuid, integer, boolean) from public;
revoke all on function public.admin_revoke_nameplate(uuid) from public;
grant execute on function public.equip_my_nameplate(uuid) to authenticated;
grant execute on function public.admin_list_nameplate_entitlements() to authenticated;
grant execute on function public.admin_grant_nameplate(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.admin_revoke_nameplate(uuid) to authenticated;

update public.reward_products
set price_points = case metadata->>'nameplate_style'
    when 'blackgold' then 3000 when 'rainbow' then 1800 else price_points end,
    metadata = metadata || jsonb_build_object('duration_days', 30),
    description = case metadata->>'nameplate_style'
      when 'blackgold' then '黑曜金属流光动态铭牌，兑换后可佩戴 30 天。'
      when 'rainbow' then '多段光谱动态铭牌，兑换后可佩戴 30 天。'
      else description end,
    updated_at = now()
where product_type = 'nameplate' and metadata->>'nameplate_style' in ('blackgold', 'rainbow');

insert into public.reward_products(
  name, summary, description, category, product_type,
  price_points, stock, metadata, active, sort_order
)
select seed.name, seed.summary, seed.description, 'identity', 'nameplate',
  seed.price_points, -1,
  jsonb_build_object('nameplate_style', seed.style, 'duration_days', 30), true, seed.sort_order
from (values
  ('新岁星霜铭牌', '冰晶银紫流光身份特效', '节庆限定质感，兑换后可佩戴 30 天。', 1600, 'newyear', 30),
  ('铂光序列铭牌', '冷银蓝金属质感身份特效', '低饱和铂金流光，兑换后可佩戴 30 天。', 1200, 'platinum', 40),
  ('紫曜鎏金铭牌', '紫金交织动态身份特效', '紫曜与鎏金交错，兑换后可佩戴 30 天。', 2200, 'purplegold', 50)
) as seed(name, summary, description, price_points, style, sort_order)
where not exists (
  select 1 from public.reward_products p
  where p.product_type = 'nameplate' and p.metadata->>'nameplate_style' = seed.style
);

-- Preserve premium styles that were granted or redeemed before ownership tracking existed.
insert into public.user_nameplates(user_id, product_id, style, expires_at, equipped, source)
select u.id, p.id, u.nameplate_style, now() + interval '3650 days', true, 'admin_grant'
from public.profiles u
join public.reward_products p
  on p.product_type = 'nameplate'
 and p.metadata->>'nameplate_style' = u.nameplate_style
where u.nameplate_style in ('blackgold', 'rainbow', 'newyear', 'platinum', 'purplegold')
  and not exists (select 1 from public.user_nameplates n where n.user_id = u.id)
on conflict (user_id, product_id) do nothing;

commit;
