begin;

create table if not exists public.reward_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_key text not null,
  reference_key text not null,
  points integer not null check (points <> 0),
  balance_after integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, action_key, reference_key)
);

create table if not exists public.reward_daily_checkins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  streak integer not null default 1 check (streak > 0),
  points integer not null check (points > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, checkin_date)
);

create table if not exists public.reward_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  summary text not null default '',
  description text not null default '',
  image_url text,
  category text not null default 'identity'
    check (category in ('identity', 'digital', 'service', 'physical')),
  product_type text not null default 'digital'
    check (product_type in ('digital', 'nameplate', 'title', 'service', 'physical')),
  price_points integer not null check (price_points > 0),
  stock integer not null default -1 check (stock >= -1),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.reward_products(id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 20),
  points_spent integer not null check (points_spent > 0),
  status text not null default 'pending'
    check (status in ('pending', 'fulfilled', 'cancelled', 'refunded')),
  fulfillment_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reward_ledger_user_created_idx
  on public.reward_ledger(user_id, created_at desc);
create index if not exists reward_products_catalog_idx
  on public.reward_products(active, sort_order, created_at);
create index if not exists reward_redemptions_admin_idx
  on public.reward_redemptions(status, created_at desc);

alter table public.reward_wallets enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.reward_daily_checkins enable row level security;
alter table public.reward_products enable row level security;
alter table public.reward_redemptions enable row level security;

drop policy if exists reward_wallets_owner_read on public.reward_wallets;
create policy reward_wallets_owner_read on public.reward_wallets
for select to authenticated using (user_id = auth.uid() or public.mentor_is_admin());

drop policy if exists reward_ledger_owner_read on public.reward_ledger;
create policy reward_ledger_owner_read on public.reward_ledger
for select to authenticated using (user_id = auth.uid() or public.mentor_is_admin());

drop policy if exists reward_checkins_owner_read on public.reward_daily_checkins;
create policy reward_checkins_owner_read on public.reward_daily_checkins
for select to authenticated using (user_id = auth.uid() or public.mentor_is_admin());

drop policy if exists reward_products_catalog_read on public.reward_products;
create policy reward_products_catalog_read on public.reward_products
for select to anon, authenticated using (active or public.mentor_is_admin());

drop policy if exists reward_products_admin_write on public.reward_products;
create policy reward_products_admin_write on public.reward_products
for all to authenticated using (public.mentor_is_admin()) with check (public.mentor_is_admin());

drop policy if exists reward_redemptions_owner_read on public.reward_redemptions;
create policy reward_redemptions_owner_read on public.reward_redemptions
for select to authenticated using (user_id = auth.uid() or public.mentor_is_admin());

create or replace function public.ensure_reward_wallet(p_user uuid)
returns public.reward_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.reward_wallets%rowtype;
begin
  insert into public.reward_wallets(user_id) values (p_user)
  on conflict (user_id) do nothing;
  select * into v_wallet from public.reward_wallets where user_id = p_user;
  return v_wallet;
end;
$$;

create or replace function public.award_reward_points(
  p_user uuid,
  p_action text,
  p_reference text,
  p_points integer,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_id bigint;
  v_balance integer;
begin
  if p_user is null or p_points <= 0 or trim(coalesce(p_reference, '')) = '' then
    raise exception 'reward_input_invalid';
  end if;
  perform public.ensure_reward_wallet(p_user);
  insert into public.reward_ledger(user_id, action_key, reference_key, points, note)
  values (p_user, trim(p_action), trim(p_reference), p_points, coalesce(p_note, ''))
  on conflict (user_id, action_key, reference_key) do nothing
  returning id into v_ledger_id;
  if v_ledger_id is null then
    select balance into v_balance from public.reward_wallets where user_id = p_user;
    return jsonb_build_object('awarded', false, 'balance', v_balance);
  end if;
  update public.reward_wallets
  set balance = balance + p_points,
      lifetime_earned = lifetime_earned + p_points,
      updated_at = now()
  where user_id = p_user
  returning balance into v_balance;
  update public.reward_ledger set balance_after = v_balance where id = v_ledger_id;
  return jsonb_build_object('awarded', true, 'points', p_points, 'balance', v_balance);
end;
$$;

create or replace function public.reward_private_entry_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'review' then
    perform public.award_reward_points(new.owner_id, 'review_saved', new.id::text, 20, '完成一篇复盘');
  end if;
  return new;
end;
$$;

drop trigger if exists reward_private_entry_created_trigger on public.private_entries;
create trigger reward_private_entry_created_trigger
after insert on public.private_entries
for each row execute function public.reward_private_entry_created();

create or replace function public.reward_post_published()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_points integer;
begin
  if new.status = 'published' and coalesce(old.status, '') <> 'published' then
    v_points := case new.board
      when 'case_submission' then 15
      when 'idea_sharing' then 12
      else 10
    end;
    perform public.award_reward_points(new.author_id, 'post_published', new.id::text, v_points, '发布公开研究内容');
  end if;
  return new;
end;
$$;

drop trigger if exists reward_post_published_trigger on public.posts;
create trigger reward_post_published_trigger
after update of status on public.posts
for each row execute function public.reward_post_published();

create or replace function public.reward_daily_checkin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_streak integer := 1;
  v_points integer;
  v_existing public.reward_daily_checkins%rowtype;
  v_reward jsonb;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select * into v_existing from public.reward_daily_checkins
  where user_id = v_user and checkin_date = current_date;
  if found then
    select jsonb_build_object(
      'checked_today', true,
      'streak', v_existing.streak,
      'points', v_existing.points,
      'balance', coalesce(w.balance, 0)
    ) into v_reward
    from public.reward_wallets w where w.user_id = v_user;
    return coalesce(v_reward, jsonb_build_object('checked_today', true, 'streak', v_existing.streak, 'points', v_existing.points, 'balance', 0));
  end if;
  select coalesce(max(streak), 0) + 1 into v_streak
  from public.reward_daily_checkins
  where user_id = v_user and checkin_date = current_date - 1;
  v_streak := greatest(1, v_streak);
  v_points := 5 + least(v_streak - 1, 6);
  insert into public.reward_daily_checkins(user_id, checkin_date, streak, points)
  values (v_user, current_date, v_streak, v_points);
  v_reward := public.award_reward_points(v_user, 'daily_checkin', current_date::text, v_points, '每日签到');
  return v_reward || jsonb_build_object('checked_today', true, 'streak', v_streak, 'points', v_points);
end;
$$;

create or replace function public.get_my_reward_center()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  perform public.ensure_reward_wallet(v_user);
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_quantity not between 1 and 20 then raise exception 'quantity_invalid'; end if;
  select * into v_product from public.reward_products where id = p_product and active for update;
  if not found or v_product.stock = 0 then raise exception 'product_unavailable'; end if;
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
    if v_style not in ('classic', 'blackgold', 'platinum', 'purplegold', 'rainbow') then
      raise exception 'nameplate_style_invalid';
    end if;
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
  return jsonb_build_object('redemption_id', v_redemption, 'status', v_status, 'balance', v_balance);
end;
$$;

create or replace function public.admin_list_reward_catalog()
returns table (
  id uuid, name text, summary text, description text, image_url text,
  category text, product_type text, price_points integer, stock integer,
  metadata jsonb, active boolean, sort_order integer, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.summary, p.description, p.image_url, p.category,
    p.product_type, p.price_points, p.stock, p.metadata, p.active,
    p.sort_order, p.created_at, p.updated_at
  from public.reward_products p where public.mentor_is_admin()
  order by p.sort_order, p.created_at;
$$;

create or replace function public.admin_upsert_reward_product(
  p_id uuid default null, p_name text default '', p_summary text default '',
  p_description text default '', p_image_url text default null,
  p_category text default 'identity', p_product_type text default 'digital',
  p_price_points integer default 100, p_stock integer default -1,
  p_metadata jsonb default '{}'::jsonb, p_active boolean default true,
  p_sort_order integer default 100
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if char_length(trim(p_name)) not between 2 and 80 then raise exception 'product_name_invalid'; end if;
  if p_price_points <= 0 or p_stock < -1 then raise exception 'product_value_invalid'; end if;
  insert into public.reward_products(
    id, name, summary, description, image_url, category, product_type,
    price_points, stock, metadata, active, sort_order
  ) values (
    coalesce(p_id, gen_random_uuid()), trim(p_name), trim(coalesce(p_summary, '')),
    trim(coalesce(p_description, '')), nullif(trim(coalesce(p_image_url, '')), ''),
    p_category, p_product_type, p_price_points, p_stock,
    coalesce(p_metadata, '{}'::jsonb), coalesce(p_active, true), p_sort_order
  )
  on conflict (id) do update set
    name = excluded.name, summary = excluded.summary, description = excluded.description,
    image_url = excluded.image_url, category = excluded.category,
    product_type = excluded.product_type, price_points = excluded.price_points,
    stock = excluded.stock, metadata = excluded.metadata, active = excluded.active,
    sort_order = excluded.sort_order, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_list_reward_redemptions()
returns table (
  id uuid, user_id uuid, public_uid integer, display_name text,
  product_id uuid, product_name text, quantity integer, points_spent integer,
  status text, fulfillment_note text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, u.public_uid, u.display_name, r.product_id, p.name,
    r.quantity, r.points_spent, r.status, r.fulfillment_note, r.created_at
  from public.reward_redemptions r
  join public.reward_products p on p.id = r.product_id
  join public.profiles u on u.id = r.user_id
  where public.mentor_is_admin()
  order by r.created_at desc limit 500;
$$;

create or replace function public.admin_list_reward_wallets()
returns table (
  user_id uuid, public_uid integer, display_name text, bio text,
  display_title text, nameplate_style text, balance integer,
  lifetime_earned integer, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.public_uid, p.display_name, p.bio, p.display_title,
    p.nameplate_style, coalesce(w.balance, 0), coalesce(w.lifetime_earned, 0),
    coalesce(w.updated_at, p.updated_at)
  from public.profiles p
  left join public.reward_wallets w on w.user_id = p.id
  where public.mentor_is_admin()
  order by coalesce(w.updated_at, p.updated_at) desc
  limit 1000;
$$;

create or replace function public.admin_adjust_reward_points(
  p_user uuid, p_delta integer, p_note text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.reward_wallets%rowtype;
  v_balance integer;
  v_reference text := gen_random_uuid()::text;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_user is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'reward_adjustment_invalid';
  end if;
  if char_length(trim(coalesce(p_note, ''))) < 2 then
    raise exception 'reward_adjustment_note_required';
  end if;
  select * into v_wallet from public.ensure_reward_wallet(p_user);
  if v_wallet.balance + p_delta < 0 then raise exception 'reward_balance_insufficient'; end if;
  update public.reward_wallets
  set balance = balance + p_delta,
      lifetime_earned = lifetime_earned + greatest(p_delta, 0),
      updated_at = now()
  where user_id = p_user
  returning balance into v_balance;
  insert into public.reward_ledger(user_id, action_key, reference_key, points, balance_after, note)
  values (p_user, 'admin_adjustment', v_reference, p_delta, v_balance, trim(p_note));
  return jsonb_build_object('balance', v_balance, 'delta', p_delta);
end;
$$;

create or replace function public.admin_update_member_profile(
  p_user uuid,
  p_display_name text,
  p_bio text default '',
  p_display_title text default '',
  p_nameplate_style text default 'classic'
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_user is null or char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'display_name_invalid';
  end if;
  if char_length(coalesce(p_bio, '')) > 200 or char_length(coalesce(p_display_title, '')) > 24 then
    raise exception 'profile_value_invalid';
  end if;
  if p_nameplate_style not in ('classic', 'blackgold', 'platinum', 'purplegold', 'rainbow') then
    raise exception 'nameplate_style_invalid';
  end if;
  update public.profiles
  set display_name = trim(p_display_name), bio = trim(coalesce(p_bio, '')),
      display_title = nullif(trim(coalesce(p_display_title, '')), ''),
      nameplate_style = p_nameplate_style, updated_at = now()
  where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
end;
$$;

create or replace function public.admin_update_reward_redemption(
  p_id uuid, p_status text, p_note text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_redemption public.reward_redemptions%rowtype;
begin
  if not public.mentor_is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('pending', 'fulfilled', 'cancelled', 'refunded') then
    raise exception 'redemption_status_invalid';
  end if;
  select * into v_redemption from public.reward_redemptions where id = p_id for update;
  if not found then raise exception 'redemption_not_found'; end if;
  update public.reward_redemptions set status = p_status,
    fulfillment_note = trim(coalesce(p_note, '')), updated_at = now()
  where id = p_id;
  if p_status = 'refunded' and v_redemption.status <> 'refunded' then
    perform public.award_reward_points(
      v_redemption.user_id,
      'redemption_refund',
      v_redemption.id::text,
      v_redemption.points_spent,
      '商城兑换退款'
    );
  end if;
end;
$$;

revoke all on function public.ensure_reward_wallet(uuid) from public;
revoke all on function public.award_reward_points(uuid, text, text, integer, text) from public;
revoke all on function public.reward_daily_checkin() from public;
revoke all on function public.get_my_reward_center() from public;
revoke all on function public.redeem_reward_product(uuid, integer) from public;
revoke all on function public.admin_list_reward_catalog() from public;
revoke all on function public.admin_upsert_reward_product(uuid, text, text, text, text, text, text, integer, integer, jsonb, boolean, integer) from public;
revoke all on function public.admin_list_reward_redemptions() from public;
revoke all on function public.admin_list_reward_wallets() from public;
revoke all on function public.admin_adjust_reward_points(uuid, integer, text) from public;
revoke all on function public.admin_update_member_profile(uuid, text, text, text, text) from public;
revoke all on function public.admin_update_reward_redemption(uuid, text, text) from public;

grant execute on function public.reward_daily_checkin() to authenticated;
grant execute on function public.get_my_reward_center() to authenticated;
grant execute on function public.redeem_reward_product(uuid, integer) to authenticated;
grant execute on function public.admin_list_reward_catalog() to authenticated;
grant execute on function public.admin_upsert_reward_product(uuid, text, text, text, text, text, text, integer, integer, jsonb, boolean, integer) to authenticated;
grant execute on function public.admin_list_reward_redemptions() to authenticated;
grant execute on function public.admin_list_reward_wallets() to authenticated;
grant execute on function public.admin_adjust_reward_points(uuid, integer, text) to authenticated;
grant execute on function public.admin_update_member_profile(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_update_reward_redemption(uuid, text, text) to authenticated;
grant select on public.reward_products to anon, authenticated;

insert into public.reward_products(name, summary, description, category, product_type, price_points, stock, metadata, active, sort_order)
select seed.name, seed.summary, seed.description, seed.category, seed.product_type,
  seed.price_points, seed.stock, seed.metadata, true, seed.sort_order
from (values
  ('鎏金研究者铭牌', '解锁黑金动态 UID 铭牌', '兑换后立即应用到昵称和 UID。', 'identity', 'nameplate', 320, -1, '{"nameplate_style":"blackgold"}'::jsonb, 10),
  ('极光波谱铭牌', '解锁炫彩流光身份特效', '兑换后立即应用动态渐变昵称与 UID 铭牌。', 'identity', 'nameplate', 880, -1, '{"nameplate_style":"rainbow"}'::jsonb, 20),
  ('结构观察者称号', '个人资料与会话同步展示', '兑换后立即替换个人身份称号。', 'identity', 'title', 260, -1, '{"display_title":"结构观察者"}'::jsonb, 30),
  ('一对一复盘优先券', '辅导专区优先答疑权益', '兑换后由管理员在订单中心确认并发放。', 'service', 'service', 1200, 50, '{}'::jsonb, 40)
) as seed(name, summary, description, category, product_type, price_points, stock, metadata, sort_order)
where not exists (select 1 from public.reward_products);

commit;
