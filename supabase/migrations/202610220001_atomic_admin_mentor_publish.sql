begin;

-- Publish a mentor and its first offer in one transaction. Reusing a UID that
-- already owns a mentor restores that catalog entry instead of violating the
-- unique owner binding and leaving the admin UI in a failed-looking state.
create or replace function public.admin_upsert_mentor_catalog_v2(
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
  p_currency text default 'USDT',
  p_duration_days integer default 30,
  p_weekly_questions integer default 3,
  p_offer_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mentor_id uuid;
  v_offer_id uuid;
  v_reused_mentor boolean := false;
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_offer_name text := btrim(coalesce(p_offer_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if not public.mentor_is_admin() then
    raise exception 'admin_required';
  end if;
  if char_length(v_display_name) not between 2 and 40 then
    raise exception 'mentor_name_invalid';
  end if;
  if char_length(v_offer_name) not between 2 and 80 then
    raise exception 'mentor_offer_name_invalid';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'mentor_offer_price_invalid';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 366 then
    raise exception 'mentor_offer_duration_invalid';
  end if;
  if p_weekly_questions is null or p_weekly_questions not between 1 and 100 then
    raise exception 'mentor_offer_weekly_questions_invalid';
  end if;
  if char_length(v_currency) not between 3 and 8 then
    raise exception 'mentor_offer_currency_invalid';
  end if;
  if p_owner_id is not null and not exists (
    select 1 from public.profiles profile where profile.id = p_owner_id
  ) then
    raise exception 'mentor_owner_not_found';
  end if;

  if p_mentor_id is null then
    if p_owner_id is not null then
      -- Serialize "create by owner" attempts so two admin tabs cannot both
      -- observe a missing row and race into the unique(owner_id) constraint.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 0));
      select mentor.id into v_mentor_id
      from public.mentor_profiles mentor
      where mentor.owner_id = p_owner_id
      for update;
      v_reused_mentor := v_mentor_id is not null;
    end if;

    if v_mentor_id is null then
      insert into public.mentor_profiles (
        owner_id, display_name, headline, bio, avatar_url, specialties,
        active, sort_order
      ) values (
        p_owner_id, v_display_name, btrim(coalesce(p_headline, '')),
        btrim(coalesce(p_bio, '')), nullif(btrim(coalesce(p_avatar_url, '')), ''),
        coalesce(p_specialties, '{}'), coalesce(p_active, true),
        coalesce(p_sort_order, 100)
      )
      returning id into v_mentor_id;
    else
      update public.mentor_profiles
      set display_name = v_display_name,
          headline = btrim(coalesce(p_headline, '')),
          bio = btrim(coalesce(p_bio, '')),
          avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
          specialties = coalesce(p_specialties, '{}'),
          active = coalesce(p_active, true),
          sort_order = coalesce(p_sort_order, sort_order),
          updated_at = now()
      where id = v_mentor_id;
    end if;
  else
    if p_owner_id is not null and exists (
      select 1 from public.mentor_profiles mentor
      where mentor.owner_id = p_owner_id and mentor.id <> p_mentor_id
    ) then
      raise exception 'mentor_owner_conflict';
    end if;

    update public.mentor_profiles
    set owner_id = coalesce(p_owner_id, owner_id),
        display_name = v_display_name,
        headline = btrim(coalesce(p_headline, '')),
        bio = btrim(coalesce(p_bio, '')),
        avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
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
    select offer.id into v_offer_id
    from public.mentor_offers offer
    where offer.id = p_offer_id and offer.mentor_id = v_mentor_id
    for update;
    if v_offer_id is null then
      raise exception 'mentor_offer_not_found';
    end if;
  elsif v_reused_mentor then
    select offer.id into v_offer_id
    from public.mentor_offers offer
    where offer.mentor_id = v_mentor_id
    order by offer.sort_order, offer.created_at
    limit 1
    for update;
  end if;

  if v_offer_id is null then
    insert into public.mentor_offers (
      mentor_id, name, price_cents, currency, duration_days,
      weekly_questions, active, sort_order
    ) values (
      v_mentor_id, v_offer_name, p_price_cents, v_currency,
      p_duration_days, p_weekly_questions, coalesce(p_offer_active, true), 10
    )
    returning id into v_offer_id;
  else
    update public.mentor_offers
    set name = v_offer_name,
        price_cents = p_price_cents,
        currency = v_currency,
        duration_days = p_duration_days,
        weekly_questions = p_weekly_questions,
        active = coalesce(p_offer_active, true),
        updated_at = now()
    where id = v_offer_id;
  end if;

  return jsonb_build_object(
    'mentor_id', v_mentor_id,
    'offer_id', v_offer_id,
    'reused_mentor', v_reused_mentor
  );
end;
$$;

revoke all on function public.admin_upsert_mentor_catalog_v2(
  uuid, uuid, uuid, text, text, text, text, text[], boolean, integer,
  text, integer, text, integer, integer, boolean
) from public, anon;
grant execute on function public.admin_upsert_mentor_catalog_v2(
  uuid, uuid, uuid, text, text, text, text, text[], boolean, integer,
  text, integer, text, integer, integer, boolean
) to authenticated;

create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '202610220001'::text; $$;
revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
