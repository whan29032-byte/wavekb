begin;

create table if not exists public.discord_game_requests (
  request_id text primary key check (request_id ~ '^[0-9]{17,20}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.discord_game_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_work_at timestamptz,
  work_date date,
  work_count integer not null default 0 check (work_count between 0 and 4),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_game_skill_catalog (
  path text not null check (path in ('esper', 'magician')),
  skill_key text not null,
  skill_name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  primary key (path, skill_key)
);

create table if not exists public.discord_game_skill_pity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  path text not null check (path in ('esper', 'magician')),
  epic_pity integer not null default 0 check (epic_pity between 0 and 9),
  legendary_pity integer not null default 0 check (legendary_pity between 0 and 49),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

create table if not exists public.discord_game_skills (
  user_id uuid not null references public.profiles(id) on delete cascade,
  path text not null check (path in ('esper', 'magician')),
  skill_key text not null,
  skill_name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  quantity integer not null default 1 check (quantity > 0),
  first_obtained_at timestamptz not null default now(),
  last_obtained_at timestamptz not null default now(),
  primary key (user_id, path, skill_key)
);

create table if not exists public.discord_game_pet_catalog (
  species_key text primary key,
  species_name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  route text not null check (route in ('shared', 'esper', 'magician')),
  emoji text not null
);

create table if not exists public.discord_game_eggs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  egg_key text not null check (egg_key in ('basic', 'premium', 'route_esper', 'route_magician')),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, egg_key)
);

create table if not exists public.discord_game_pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  species_key text not null references public.discord_game_pet_catalog(species_key),
  species_name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  route text not null check (route in ('shared', 'esper', 'magician')),
  emoji text not null,
  nickname text,
  source text not null check (source in ('adoption', 'basic_egg', 'route_egg', 'premium_egg')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists discord_game_pets_one_active
on public.discord_game_pets(user_id) where active;

create table if not exists public.discord_game_pet_adoptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  adoption_date date not null,
  pet_id uuid not null references public.discord_game_pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, adoption_date)
);

create table if not exists public.discord_market_rounds (
  market_date date not null,
  symbol text not null check (symbol in ('academy', 'grimoire', 'petegg')),
  display_name text not null,
  sort_order integer not null,
  change_bps integer not null check (change_bps between -900 and 900 and change_bps <> 0),
  created_at timestamptz not null default now(),
  primary key (market_date, symbol)
);

create table if not exists public.discord_market_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_date date not null,
  symbol text not null,
  direction text not null check (direction in ('up', 'down')),
  stake integer not null check (stake between 10 and 500),
  payout integer,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (market_date, symbol) references public.discord_market_rounds(market_date, symbol),
  check ((settled_at is null) = (payout is null))
);

create index if not exists discord_market_bets_pending
on public.discord_market_bets(market_date, settled_at) where settled_at is null;

insert into public.discord_game_skill_catalog(path, skill_key, skill_name, rarity) values
  ('esper','pyrokinesis','发火能力','common'),
  ('esper','telekinesis','念动力','common'),
  ('esper','electromagnetic_sense','电磁感应','common'),
  ('esper','clairvoyance','透视能力','common'),
  ('esper','spatial_sense','空间感知','rare'),
  ('esper','memory_control','记忆操作','rare'),
  ('esper','hydro_hand','水流操作','rare'),
  ('esper','railgun','电击使','epic'),
  ('esper','teleport','空间移动','epic'),
  ('esper','meltdown','原子崩坏','epic'),
  ('esper','vector_control','矢量操作','legendary'),
  ('esper','dark_matter','未元物质','legendary'),
  ('magician','basic_rune','基础符文','common'),
  ('magician','elemental_spell','元素术式','common'),
  ('magician','healing_spell','治愈术式','common'),
  ('magician','barrier_spell','结界术','common'),
  ('magician','alchemy','炼金术','rare'),
  ('magician','astrology','占星术','rare'),
  ('magician','summoning','召唤术','rare'),
  ('magician','saint_spell','圣人术式','epic'),
  ('magician','grimoire_analysis','魔道书解析','epic'),
  ('magician','dragon_spell','龙王术式','epic'),
  ('magician','gods_right_seat','神之右席','legendary'),
  ('magician','magic_god_candidate','魔神候补','legendary')
on conflict (path, skill_key) do update
set skill_name=excluded.skill_name, rarity=excluded.rarity;

insert into public.discord_game_pet_catalog(species_key,species_name,rarity,route,emoji) values
  ('gekota','呱太','common','shared','🐸'),
  ('calico_cat','三花猫','common','shared','🐱'),
  ('mechanical_dog','机械犬','rare','shared','🐕'),
  ('rune_owl','符文猫头鹰','rare','shared','🦉'),
  ('dragonling','幼龙','epic','shared','🐉'),
  ('kirin','星辉麒麟','epic','shared','🦄'),
  ('phoenix','不死鸟','legendary','shared','🔥'),
  ('index_spirit','禁书精灵','legendary','shared','📕'),
  ('electric_sprite','电磁精灵','common','esper','⚡'),
  ('aim_fox','AIM小狐','rare','esper','🦊'),
  ('misaka_unit','迷你御坂','epic','esper','🔋'),
  ('level_six_core','第六位核心','legendary','esper','💠'),
  ('rune_slime','符文史莱姆','common','magician','🔮'),
  ('alchemy_raven','炼金渡鸦','rare','magician','🐦‍⬛'),
  ('grim_dragon','魔导幼龙','epic','magician','🐲'),
  ('angel_familiar','天使使魔','legendary','magician','👼')
on conflict (species_key) do update
set species_name=excluded.species_name,rarity=excluded.rarity,route=excluded.route,emoji=excluded.emoji;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'discord_game_requests','discord_game_profiles','discord_game_skill_catalog',
    'discord_game_skill_pity','discord_game_skills','discord_game_pet_catalog',
    'discord_game_eggs','discord_game_pets','discord_game_pet_adoptions',
    'discord_market_rounds','discord_market_bets'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$$;

create or replace function public.discord_game_member_json(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'uid', p.public_uid,
    'displayName', p.display_name,
    'avatarUrl', p.avatar_url,
    'discordUserId', p.discord_user_id
  )
  from public.profiles p where p.id=p_user
$$;

create or replace function public.discord_game_debit(
  p_user uuid, p_action text, p_reference text, p_points integer, p_note text, p_now timestamptz
) returns integer language plpgsql security definer set search_path='' as $$
declare v_balance integer; v_ledger bigint;
begin
  if p_points <= 0 then raise exception 'game_debit_invalid'; end if;
  perform public.ensure_reward_wallet(p_user);
  select balance into v_balance from public.reward_wallets where user_id=p_user for update;
  if v_balance < p_points then raise exception 'reward_balance_insufficient'; end if;
  update public.reward_wallets set balance=balance-p_points,updated_at=p_now
  where user_id=p_user returning balance into v_balance;
  insert into public.reward_ledger(user_id,action_key,reference_key,points,balance_after,note,created_at)
  values(p_user,p_action,p_reference,-p_points,v_balance,p_note,p_now)
  returning id into v_ledger;
  return v_balance;
end;
$$;

create or replace function public.discord_game_daily_checkin_for_user(p_user uuid,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_day date := (p_now at time zone 'Asia/Shanghai')::date;
  v_existing public.reward_daily_checkins%rowtype;
  v_streak integer := 1;
  v_points integer;
  v_reward jsonb;
  v_balance integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||':'||v_day::text,0));
  select * into v_existing from public.reward_daily_checkins
  where user_id=p_user and checkin_date=v_day;
  if found then
    perform public.ensure_reward_wallet(p_user);
    select balance into v_balance from public.reward_wallets where user_id=p_user;
    return pg_catalog.jsonb_build_object(
      'action','daily_checkin','awarded',false,'points',v_existing.points,
      'streak',v_existing.streak,'balance',v_balance
    );
  end if;
  select coalesce(max(streak),0)+1 into v_streak from public.reward_daily_checkins
  where user_id=p_user and checkin_date=v_day-1;
  v_streak:=greatest(1,v_streak);
  v_points:=5+least(v_streak-1,6);
  insert into public.reward_daily_checkins(user_id,checkin_date,streak,points,created_at)
  values(p_user,v_day,v_streak,v_points,p_now);
  v_reward:=public.award_reward_points(p_user,'daily_checkin',v_day::text,v_points,'每日签到');
  return pg_catalog.jsonb_build_object(
    'action','daily_checkin','awarded',true,'points',v_points,
    'streak',v_streak,'balance',(v_reward->>'balance')::integer
  );
end;
$$;

create or replace function public.reward_daily_checkin()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  return public.discord_game_daily_checkin_for_user(v_user,pg_catalog.clock_timestamp());
end;
$$;

create or replace function public.discord_game_ensure_market(p_day date,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_symbol text; v_name text; v_order integer; v_change integer;
begin
  for v_symbol,v_name,v_order in
    select * from (values
      ('academy'::text,'学园都市科技指数'::text,1),
      ('grimoire'::text,'魔导书术式指数'::text,2),
      ('petegg'::text,'幻想宠物蛋指数'::text,3)
    ) value(symbol,name,sort_order)
  loop
    v_change:=(case when random()<0.5 then -1 else 1 end)*(50+floor(random()*851)::integer);
    insert into public.discord_market_rounds(market_date,symbol,display_name,sort_order,change_bps,created_at)
    values(p_day,v_symbol,v_name,v_order,v_change,p_now) on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.discord_game_settle_markets(p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_local timestamp:=(p_now at time zone 'Asia/Shanghai');
  v_day date:=v_local::date;
  v_bet record;
  v_correct boolean;
  v_payout integer;
begin
  for v_bet in
    select b.*,r.change_bps from public.discord_market_bets b
    join public.discord_market_rounds r using(market_date,symbol)
    where b.settled_at is null and (b.market_date<v_day or (b.market_date=v_day and v_local::time>=time '22:00'))
    order by b.created_at,b.id for update of b
  loop
    v_correct:=(v_bet.direction='up' and v_bet.change_bps>0) or
      (v_bet.direction='down' and v_bet.change_bps<0);
    v_payout:=case when v_correct then (v_bet.stake*18)/10 else 0 end;
    if v_payout>0 then
      perform public.award_reward_points(
        v_bet.user_id,'discord_market_payout',v_bet.id::text,v_payout,
        '虚拟行情结算：'||v_bet.symbol
      );
    end if;
    update public.discord_market_bets set payout=v_payout,settled_at=p_now where id=v_bet.id;
  end loop;
end;
$$;

create or replace function public.discord_game_new_pet(
  p_user uuid,p_path text,p_rarity text,p_source text,p_pool text,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_species public.discord_game_pet_catalog%rowtype; v_pet public.discord_game_pets%rowtype; v_uid integer;
begin
  select * into v_species from public.discord_game_pet_catalog
  where rarity=p_rarity and (
    (p_pool='route' and route=p_path) or
    (p_pool='shared' and route='shared') or
    (p_pool='mixed' and route in ('shared',p_path))
  ) order by random() limit 1;
  if not found then raise exception 'pet_catalog_unavailable'; end if;
  insert into public.discord_game_pets(
    user_id,species_key,species_name,rarity,route,emoji,source,created_at
  ) values (
    p_user,v_species.species_key,v_species.species_name,v_species.rarity,v_species.route,
    v_species.emoji,p_source,p_now
  ) returning * into v_pet;
  select public_uid into v_uid from public.profiles where id=p_user;
  return pg_catalog.jsonb_build_object(
    'id',v_pet.id,'speciesKey',v_pet.species_key,'name',v_pet.species_name,
    'nickname',v_pet.nickname,'rarity',v_pet.rarity,'route',v_pet.route,
    'emoji',v_pet.emoji,'source',v_pet.source,'active',v_pet.active,'ownerUid',v_uid
  );
end;
$$;

create or replace function public.discord_game_action_at(
  p_discord_user_id text,p_request_id text,p_action text,p_payload jsonb,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_profile public.profiles%rowtype;
  v_existing public.discord_game_requests%rowtype;
  v_response jsonb;
  v_balance integer;
  v_local timestamp:=(p_now at time zone 'Asia/Shanghai');
  v_day date:=v_local::date;
  v_path text;
  v_points integer;
  v_count integer;
  v_cost integer;
  v_job text;
  v_skill public.discord_game_skill_catalog%rowtype;
  v_pity public.discord_game_skill_pity%rowtype;
  v_rarity text;
  v_roll integer;
  v_is_new boolean;
  v_compensation integer;
  v_draws jsonb:='[]'::jsonb;
  v_i integer;
  v_egg_type text;
  v_egg_key text;
  v_eggs integer;
  v_pets jsonb:='[]'::jsonb;
  v_pet jsonb;
  v_phase text;
  v_symbols jsonb;
  v_symbol text;
  v_direction text;
  v_stake integer;
  v_daily_stake integer;
  v_entity_id uuid;
  v_name text;
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'invalid_discord_user';
  end if;
  if p_request_id is null or p_request_id !~ '^[0-9]{17,20}$' then
    raise exception 'invalid_request_id';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object' then
    raise exception 'invalid_payload';
  end if;
  if p_action not in (
    'status','daily_checkin','work','skill_draw','skill_collection','pet_shop',
    'pet_buy_egg','pet_hatch','pet_adopt','pet_list','pet_rename','pet_activate',
    'market_view','market_bet'
  ) then raise exception 'game_action_invalid'; end if;

  select * into v_profile from public.profiles where discord_user_id=p_discord_user_id;
  if not found then raise exception 'not_linked'; end if;
  if v_profile.account_status<>'active' then raise exception 'account_restricted'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id,0));
  select * into v_existing from public.discord_game_requests where request_id=p_request_id;
  if found then
    if v_existing.user_id<>v_profile.id or v_existing.action<>p_action then
      raise exception 'request_id_conflict';
    end if;
    return v_existing.response;
  end if;

  perform public.discord_game_settle_markets(p_now);
  perform public.ensure_reward_wallet(v_profile.id);

  if p_action='status' then
    select balance into v_balance from public.reward_wallets where user_id=v_profile.id;
    v_response:=pg_catalog.jsonb_build_object(
      'action','status','balance',v_balance,
      'checkedToday',exists(select 1 from public.reward_daily_checkins where user_id=v_profile.id and checkin_date=v_day),
      'petCount',(select count(*) from public.discord_game_pets where user_id=v_profile.id)
    );

  elsif p_action='daily_checkin' then
    v_response:=public.discord_game_daily_checkin_for_user(v_profile.id,p_now);

  elsif p_action='work' then
    v_path:=p_payload->>'path';
    if v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    insert into public.discord_game_profiles(user_id,work_date) values(v_profile.id,v_day)
    on conflict(user_id) do nothing;
  end if;

  if p_action='work' then
    declare v_game_profile public.discord_game_profiles%rowtype;
    begin
      select * into v_game_profile from public.discord_game_profiles where user_id=v_profile.id for update;
      if v_game_profile.work_date is distinct from v_day then
        v_game_profile.work_count:=0;
      end if;
      if v_game_profile.last_work_at is not null and p_now<v_game_profile.last_work_at+interval '4 hours' then
        raise exception 'work_cooldown';
      end if;
      if v_game_profile.work_count>=4 then raise exception 'work_daily_limit'; end if;
      v_points:=25+floor(random()*36)::integer;
      v_job:=case when v_path='esper' then
        (array['协助能力开发实验','维护学园都市无人机','整理超能力研究档案'])[1+floor(random()*3)::integer]
      else
        (array['抄录魔导书','维护术式结界','为教会整理灵装'])[1+floor(random()*3)::integer]
      end;
      update public.discord_game_profiles set last_work_at=p_now,work_date=v_day,
        work_count=v_game_profile.work_count+1,updated_at=p_now where user_id=v_profile.id;
      v_response:=public.award_reward_points(v_profile.id,'discord_work',p_request_id,v_points,'Discord 打工：'||v_job)
        ||pg_catalog.jsonb_build_object(
          'action','work','path',v_path,'job',v_job,'points',v_points,
          'workCount',v_game_profile.work_count+1,'nextAvailableAt',p_now+interval '4 hours'
        );
    end;

  elsif p_action='skill_draw' then
    v_path:=p_payload->>'path'; v_count:=coalesce((p_payload->>'count')::integer,0);
    if v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    if v_count not in (1,10) then raise exception 'skill_draw_count_invalid'; end if;
    v_cost:=case when v_count=1 then 100 else 900 end;
    perform public.discord_game_debit(v_profile.id,'discord_skill_draw',p_request_id,v_cost,'技能抽取',p_now);
    insert into public.discord_game_skill_pity(user_id,path) values(v_profile.id,v_path) on conflict do nothing;
    select * into v_pity from public.discord_game_skill_pity where user_id=v_profile.id and path=v_path for update;
    for v_i in 1..v_count loop
      if v_pity.legendary_pity>=49 then v_rarity:='legendary';
      elsif v_pity.epic_pity>=9 then v_rarity:='epic';
      else
        v_roll:=floor(random()*10000)::integer;
        v_rarity:=case when v_roll<7000 then 'common' when v_roll<9400 then 'rare'
          when v_roll<9900 then 'epic' else 'legendary' end;
      end if;
      select * into v_skill from public.discord_game_skill_catalog
      where path=v_path and rarity=v_rarity order by random() limit 1;
      select not exists(
        select 1 from public.discord_game_skills
        where user_id=v_profile.id and path=v_path and skill_key=v_skill.skill_key
      ) into v_is_new;
      insert into public.discord_game_skills(user_id,path,skill_key,skill_name,rarity,first_obtained_at,last_obtained_at)
      values(v_profile.id,v_path,v_skill.skill_key,v_skill.skill_name,v_skill.rarity,p_now,p_now)
      on conflict(user_id,path,skill_key) do update
      set quantity=public.discord_game_skills.quantity+1,last_obtained_at=excluded.last_obtained_at;
      v_compensation:=case when v_is_new then 0 else case v_rarity
        when 'common' then 15 when 'rare' then 35 when 'epic' then 90 else 250 end end;
      if v_compensation>0 then
        perform public.award_reward_points(
          v_profile.id,'discord_skill_duplicate',p_request_id||':'||v_i,v_compensation,
          '重复技能补偿：'||v_skill.skill_name
        );
      end if;
      if v_rarity='legendary' then v_pity.epic_pity:=0;v_pity.legendary_pity:=0;
      elsif v_rarity='epic' then v_pity.epic_pity:=0;v_pity.legendary_pity:=least(49,v_pity.legendary_pity+1);
      else v_pity.epic_pity:=least(9,v_pity.epic_pity+1);v_pity.legendary_pity:=least(49,v_pity.legendary_pity+1);
      end if;
      v_draws:=v_draws||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'key',v_skill.skill_key,'name',v_skill.skill_name,'rarity',v_rarity,
        'isNew',v_is_new,'compensation',v_compensation
      ));
    end loop;
    update public.discord_game_skill_pity set epic_pity=v_pity.epic_pity,
      legendary_pity=v_pity.legendary_pity,updated_at=p_now
    where user_id=v_profile.id and path=v_path;
    select balance into v_balance from public.reward_wallets where user_id=v_profile.id;
    v_response:=pg_catalog.jsonb_build_object(
      'action','skill_draw','path',v_path,'cost',v_cost,'draws',v_draws,'balance',v_balance,
      'pity',pg_catalog.jsonb_build_object('epic',v_pity.epic_pity,'legendary',v_pity.legendary_pity)
    );

  elsif p_action='skill_collection' then
    v_path:=p_payload->>'path';
    if v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    select balance into v_balance from public.reward_wallets where user_id=v_profile.id;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'key',skill_key,'name',skill_name,'rarity',rarity,'quantity',quantity
    ) order by first_obtained_at),'[]'::jsonb) into v_draws
    from public.discord_game_skills where user_id=v_profile.id and path=v_path;
    select * into v_pity from public.discord_game_skill_pity where user_id=v_profile.id and path=v_path;
    v_response:=pg_catalog.jsonb_build_object(
      'action','skill_collection','path',v_path,'balance',v_balance,'skills',v_draws,
      'pity',pg_catalog.jsonb_build_object('epic',coalesce(v_pity.epic_pity,0),'legendary',coalesce(v_pity.legendary_pity,0))
    );

  elsif p_action='pet_shop' then
    select balance into v_balance from public.reward_wallets where user_id=v_profile.id;
    v_response:=pg_catalog.jsonb_build_object(
      'action','pet_shop','balance',v_balance,
      'eggs',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type','basic','name','普通宠物蛋','price',150),
        pg_catalog.jsonb_build_object('type','route','name','阵营宠物蛋','price',350),
        pg_catalog.jsonb_build_object('type','premium','name','幻想宠物蛋','price',700)
      )
    );

  elsif p_action='pet_buy_egg' then
    v_egg_type:=p_payload->>'eggType';v_count:=coalesce((p_payload->>'quantity')::integer,0);v_path:=p_payload->>'path';
    if v_count<1 or v_count>10 then raise exception 'pet_quantity_invalid'; end if;
    if v_egg_type not in ('basic','route','premium') then raise exception 'pet_egg_invalid'; end if;
    if v_egg_type='route' and v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    v_egg_key:=case when v_egg_type='route' then 'route_'||v_path else v_egg_type end;
    v_cost:=(case v_egg_type when 'basic' then 150 when 'route' then 350 else 700 end)*v_count;
    v_balance:=public.discord_game_debit(v_profile.id,'discord_pet_egg',p_request_id,v_cost,'购买宠物蛋',p_now);
    insert into public.discord_game_eggs(user_id,egg_key,quantity,updated_at)
    values(v_profile.id,v_egg_key,v_count,p_now)
    on conflict(user_id,egg_key) do update set quantity=public.discord_game_eggs.quantity+excluded.quantity,updated_at=excluded.updated_at
    returning quantity into v_eggs;
    v_response:=pg_catalog.jsonb_build_object(
      'action','pet_buy_egg','eggType',v_egg_type,'quantity',v_count,'cost',v_cost,
      'balance',v_balance,'eggs',v_eggs
    );

  elsif p_action='pet_hatch' then
    v_egg_type:=p_payload->>'eggType';v_count:=coalesce((p_payload->>'quantity')::integer,0);v_path:=p_payload->>'path';
    if v_count<1 or v_count>10 then raise exception 'pet_quantity_invalid'; end if;
    if v_egg_type not in ('basic','route','premium') then raise exception 'pet_egg_invalid'; end if;
    if v_egg_type='route' and v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    v_egg_key:=case when v_egg_type='route' then 'route_'||v_path else v_egg_type end;
    select quantity into v_eggs from public.discord_game_eggs where user_id=v_profile.id and egg_key=v_egg_key for update;
    if coalesce(v_eggs,0)<v_count then raise exception 'pet_egg_insufficient'; end if;
    update public.discord_game_eggs set quantity=quantity-v_count,updated_at=p_now
    where user_id=v_profile.id and egg_key=v_egg_key returning quantity into v_eggs;
    for v_i in 1..v_count loop
      v_roll:=floor(random()*10000)::integer;
      if v_egg_type='basic' then
        v_rarity:=case when v_roll<7000 then 'common' when v_roll<9500 then 'rare' when v_roll<9950 then 'epic' else 'legendary' end;
      elsif v_egg_type='route' then
        v_rarity:=case when v_roll<4500 then 'common' when v_roll<8300 then 'rare' when v_roll<9700 then 'epic' else 'legendary' end;
      else
        v_rarity:=case when v_roll<2000 then 'common' when v_roll<6500 then 'rare' when v_roll<9300 then 'epic' else 'legendary' end;
      end if;
      v_pet:=public.discord_game_new_pet(
        v_profile.id,v_path,v_rarity,
        case v_egg_type when 'basic' then 'basic_egg' when 'route' then 'route_egg' else 'premium_egg' end,
        case when v_egg_type='route' then 'route' else 'shared' end,p_now
      );
      v_pets:=v_pets||pg_catalog.jsonb_build_array(v_pet);
    end loop;
    v_response:=pg_catalog.jsonb_build_object(
      'action','pet_hatch','eggType',v_egg_type,'pets',v_pets,'eggsRemaining',v_eggs
    );

  elsif p_action='pet_adopt' then
    v_path:=p_payload->>'path';
    if v_path not in ('esper','magician') then raise exception 'game_path_invalid'; end if;
    if exists(select 1 from public.discord_game_pet_adoptions where user_id=v_profile.id and adoption_date=v_day) then
      raise exception 'pet_adoption_already_used';
    end if;
    v_roll:=floor(random()*10000)::integer;
    v_rarity:=case when v_roll<7800 then 'common' when v_roll<9600 then 'rare' when v_roll<9950 then 'epic' else 'legendary' end;
    v_pet:=public.discord_game_new_pet(v_profile.id,v_path,v_rarity,'adoption','mixed',p_now);
    insert into public.discord_game_pet_adoptions(user_id,adoption_date,pet_id,created_at)
    values(v_profile.id,v_day,(v_pet->>'id')::uuid,p_now);
    v_response:=pg_catalog.jsonb_build_object('action','pet_adopt','pet',v_pet);

  elsif p_action='pet_list' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',id,'name',species_name,'nickname',nickname,'rarity',rarity,'route',route,
      'emoji',emoji,'source',source,'active',active
    ) order by created_at desc),'[]'::jsonb) into v_pets
    from public.discord_game_pets where user_id=v_profile.id;
    select coalesce(pg_catalog.jsonb_object_agg(egg_key,quantity),'{}'::jsonb) into v_draws
    from public.discord_game_eggs where user_id=v_profile.id and quantity>0;
    v_response:=pg_catalog.jsonb_build_object('action','pet_list','pets',v_pets,'eggs',v_draws);

  elsif p_action='pet_rename' then
    v_name:=pg_catalog.btrim(p_payload->>'name');
    if v_name is null or pg_catalog.char_length(v_name)<1 or pg_catalog.char_length(v_name)>16 or v_name~'[\r\n]' then
      raise exception 'pet_name_invalid';
    end if;
    update public.discord_game_pets set nickname=v_name
    where id=(p_payload->>'petId')::uuid and user_id=v_profile.id returning id into v_entity_id;
    if v_entity_id is null then raise exception 'pet_not_found'; end if;
    v_response:=pg_catalog.jsonb_build_object('action','pet_rename','petId',v_entity_id,'name',v_name);

  elsif p_action='pet_activate' then
    select id into v_entity_id from public.discord_game_pets
    where id=(p_payload->>'petId')::uuid and user_id=v_profile.id for update;
    if v_entity_id is null then raise exception 'pet_not_found'; end if;
    update public.discord_game_pets set active=false where user_id=v_profile.id and active;
    update public.discord_game_pets set active=true where id=v_entity_id;
    v_response:=pg_catalog.jsonb_build_object('action','pet_activate','petId',v_entity_id,'active',true);

  elsif p_action='market_view' then
    perform public.discord_game_ensure_market(v_day,p_now);
    v_phase:=case when v_local::time<time '21:00' then 'open' when v_local::time<time '22:00' then 'closed' else 'settled' end;
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'symbol',r.symbol,'name',r.display_name,
      'changeBps',case when v_phase='settled' then r.change_bps else null end,
      'direction',case when v_phase='settled' then case when r.change_bps>0 then 'up' else 'down' end else null end
    ) order by r.sort_order) into v_symbols from public.discord_market_rounds r where r.market_date=v_day;
    select coalesce(sum(stake),0) into v_daily_stake from public.discord_market_bets where user_id=v_profile.id and market_date=v_day;
    v_response:=pg_catalog.jsonb_build_object(
      'action','market_view','date',v_day,'phase',v_phase,'symbols',v_symbols,
      'dailyStake',v_daily_stake,'dailyLimit',500,'closesAt',v_day+time '21:00','settlesAt',v_day+time '22:00'
    );

  elsif p_action='market_bet' then
    if v_local::time>=time '21:00' then raise exception 'market_closed'; end if;
    v_symbol:=p_payload->>'symbol';v_direction:=p_payload->>'direction';v_stake:=coalesce((p_payload->>'stake')::integer,0);
    if v_symbol not in ('academy','grimoire','petegg') then raise exception 'market_symbol_invalid'; end if;
    if v_direction not in ('up','down') then raise exception 'market_direction_invalid'; end if;
    if v_stake<10 or v_stake>500 then raise exception 'market_stake_invalid'; end if;
    perform public.discord_game_ensure_market(v_day,p_now);
    select coalesce(sum(stake),0) into v_daily_stake from public.discord_market_bets
    where user_id=v_profile.id and market_date=v_day;
    if v_daily_stake+v_stake>500 then raise exception 'market_daily_limit'; end if;
    v_balance:=public.discord_game_debit(v_profile.id,'discord_market_bet',p_request_id,v_stake,'虚拟行情下注：'||v_symbol,p_now);
    insert into public.discord_market_bets(user_id,market_date,symbol,direction,stake,created_at)
    values(v_profile.id,v_day,v_symbol,v_direction,v_stake,p_now);
    v_response:=pg_catalog.jsonb_build_object(
      'action','market_bet','date',v_day,'symbol',v_symbol,'direction',v_direction,
      'stake',v_stake,'dailyStake',v_daily_stake+v_stake,'balance',v_balance
    );

  end if;

  if v_response is null then raise exception 'game_action_unhandled'; end if;
  insert into public.discord_game_requests(request_id,user_id,action,response,created_at)
  values(p_request_id,v_profile.id,p_action,v_response,p_now);
  return v_response;
end;
$$;

create or replace function public.discord_game_action(
  p_discord_user_id text,p_request_id text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language sql security definer set search_path='' as $$
  select public.discord_game_action_at(
    p_discord_user_id,p_request_id,p_action,coalesce(p_payload,'{}'::jsonb),pg_catalog.clock_timestamp()
  )
$$;

revoke all on function public.discord_game_member_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_debit(uuid,text,text,integer,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_daily_checkin_for_user(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_ensure_market(date,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_settle_markets(timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_new_pet(uuid,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_action_at(text,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.discord_game_action(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.discord_game_action(text,text,text,jsonb) to service_role;

revoke all on function public.reward_daily_checkin() from public,anon,service_role;
grant execute on function public.reward_daily_checkin() to authenticated;

create or replace function public.wavekb_schema_version()
returns text language sql stable security invoker set search_path='' as $$
  select '202611250002'::text
$$;
revoke all on function public.wavekb_schema_version() from public,anon,authenticated,service_role;
grant execute on function public.wavekb_schema_version() to anon,authenticated,service_role;

commit;
