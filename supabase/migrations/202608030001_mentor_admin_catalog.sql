begin;

-- 管理员辅导目录的只增量增强：原子保存老师资料与首个方案，避免后台逐表写入留下半成品。
create or replace function public.admin_list_mentor_catalog()
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
  mentor_offers jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.owner_id,
    m.display_name,
    m.headline,
    m.bio,
    m.avatar_url,
    m.specialties,
    m.credentials,
    m.languages,
    m.verification_label,
    m.active,
    m.sort_order,
    coalesce(
      jsonb_agg(to_jsonb(o) order by o.sort_order, o.created_at)
        filter (where o.id is not null),
      '[]'::jsonb
    )
  from public.mentor_profiles m
  left join public.mentor_offers o on o.mentor_id = m.id
  where public.mentor_is_admin()
  group by m.id;
$$;

create or replace function public.admin_upsert_mentor_catalog(
  p_mentor_id uuid default null,
  p_offer_id uuid default null,
  p_owner_id uuid default null,
  p_display_name text default '',
  p_headline text default '',
  p_bio text default '',
  p_avatar_url text default null,
  p_specialties text[] default '{}',
  p_active boolean default true,
  p_sort_order integer default 100,
  p_offer_name text default '一对一波浪辅导',
  p_price_cents integer default 0,
  p_currency text default 'CNY',
  p_duration_days integer default 30,
  p_weekly_questions integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor_id uuid;
  v_offer_id uuid;
begin
  if not public.mentor_is_admin() then
    raise exception 'admin_required';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) not between 2 and 40 then
    raise exception 'mentor_name_invalid';
  end if;

  if p_mentor_id is null then
    insert into public.mentor_profiles (
      owner_id, display_name, headline, bio, avatar_url, specialties,
      active, sort_order
    ) values (
      p_owner_id,
      trim(p_display_name),
      coalesce(trim(p_headline), ''),
      coalesce(trim(p_bio), ''),
      nullif(trim(coalesce(p_avatar_url, '')), ''),
      coalesce(p_specialties, '{}'),
      coalesce(p_active, true),
      coalesce(p_sort_order, 100)
    )
    returning id into v_mentor_id;
  else
    update public.mentor_profiles
    -- 编辑老师时未填写账户 UUID 代表“保持原绑定”，避免保存资料时意外解绑。
    set owner_id = coalesce(p_owner_id, owner_id),
        display_name = trim(p_display_name),
        headline = coalesce(trim(p_headline), ''),
        bio = coalesce(trim(p_bio), ''),
        avatar_url = nullif(trim(coalesce(p_avatar_url, '')), ''),
        specialties = coalesce(p_specialties, '{}'),
        active = coalesce(p_active, true),
        sort_order = coalesce(p_sort_order, sort_order),
        updated_at = now()
    where id = p_mentor_id
    returning id into v_mentor_id;

    if v_mentor_id is null then
      raise exception 'mentor_not_found';
    end if;
  end if;

  if p_offer_id is not null then
    update public.mentor_offers
    set name = trim(coalesce(p_offer_name, '一对一波浪辅导')),
        price_cents = greatest(0, coalesce(p_price_cents, 0)),
        currency = upper(coalesce(p_currency, 'CNY')),
        duration_days = coalesce(p_duration_days, 30),
        weekly_questions = coalesce(p_weekly_questions, 3),
        active = true,
        updated_at = now()
    where id = p_offer_id and mentor_id = v_mentor_id
    returning id into v_offer_id;
  end if;

  if v_offer_id is null then
    insert into public.mentor_offers (
      mentor_id, name, price_cents, currency, duration_days,
      weekly_questions, active, sort_order
    ) values (
      v_mentor_id,
      trim(coalesce(p_offer_name, '一对一波浪辅导')),
      greatest(0, coalesce(p_price_cents, 0)),
      upper(coalesce(p_currency, 'CNY')),
      coalesce(p_duration_days, 30),
      coalesce(p_weekly_questions, 3),
      true,
      10
    )
    returning id into v_offer_id;
  end if;

  return jsonb_build_object('mentor_id', v_mentor_id, 'offer_id', v_offer_id);
end;
$$;

revoke all on function public.admin_list_mentor_catalog() from public;
revoke all on function public.admin_upsert_mentor_catalog(
  uuid, uuid, uuid, text, text, text, text, text[], boolean, integer,
  text, integer, text, integer, integer
) from public;
grant execute on function public.admin_list_mentor_catalog() to authenticated;
grant execute on function public.admin_upsert_mentor_catalog(
  uuid, uuid, uuid, text, text, text, text, text[], boolean, integer,
  text, integer, text, integer, integer
) to authenticated;

commit;
