begin;

-- A platform profile remains the owner of a bound mentor's public avatar.
-- The catalog value is retained solely for legacy, unbound, or empty-profile fallbacks.
create or replace function public.mentor_display_avatar(
  p_owner_id uuid,
  p_fallback_avatar_url text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(btrim(profile.avatar_url), '')
      from public.profiles profile
      where profile.id = p_owner_id
    ),
    p_fallback_avatar_url
  );
$$;

create or replace function public.list_mentor_catalog()
returns table (
  mentor_id uuid,
  display_name text,
  headline text,
  bio text,
  avatar_url text,
  specialties text[],
  credentials text[],
  languages text[],
  verification_label text,
  offers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.display_name,
    m.headline,
    m.bio,
    public.mentor_display_avatar(m.owner_id, m.avatar_url),
    m.specialties,
    m.credentials,
    m.languages,
    m.verification_label,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'description', o.description,
          'price_cents', o.price_cents,
          'currency', o.currency,
          'duration_days', o.duration_days,
          'weekly_questions', o.weekly_questions,
          'active', o.active
        )
        order by o.sort_order, o.created_at
      ) filter (where o.id is not null and o.active),
      '[]'::jsonb
    )
  from public.mentor_profiles m
  left join public.mentor_offers o on o.mentor_id = m.id
  where m.active
  group by m.id
  order by m.sort_order, m.created_at;
$$;

create or replace function public.get_mentor_detail(p_mentor_id uuid)
returns table (
  mentor_id uuid,
  display_name text,
  headline text,
  bio text,
  avatar_url text,
  specialties text[],
  credentials text[],
  languages text[],
  verification_label text,
  offers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select catalog.*
  from public.list_mentor_catalog() catalog
  where catalog.mentor_id = p_mentor_id;
$$;

create or replace function public.list_my_mentor_access()
returns table (
  entitlement_id uuid,
  mentor_id uuid,
  mentor_name text,
  mentor_avatar_url text,
  thread_id uuid,
  status text,
  weekly_question_limit integer,
  questions_used bigint,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.mentor_id,
    m.display_name,
    public.mentor_display_avatar(m.owner_id, m.avatar_url),
    t.id,
    case
      when e.status = 'active' and e.ends_at > now() then 'active'
      when e.status = 'active' then 'expired'
      else e.status
    end,
    e.weekly_question_limit,
    (
      select count(*)
      from public.mentor_messages message
      where message.thread_id = t.id
        and message.counts_quota
        and message.quota_week = date_trunc('week', now())::date
    ),
    e.starts_at,
    e.ends_at
  from public.mentor_entitlements e
  join public.mentor_profiles m on m.id = e.mentor_id
  join public.mentor_threads t on t.entitlement_id = e.id
  where e.student_id = auth.uid()
  order by e.created_at desc;
$$;

create or replace function public.get_mentor_thread(p_thread_id uuid)
returns table (
  thread_id uuid,
  mentor_id uuid,
  mentor_name text,
  mentor_avatar_url text,
  student_id uuid,
  status text,
  weekly_question_limit integer,
  questions_used bigint,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.mentor_id,
    m.display_name,
    public.mentor_display_avatar(m.owner_id, m.avatar_url),
    t.student_id,
    case
      when e.status = 'active' and e.ends_at > now() then 'active'
      when e.status = 'active' then 'expired'
      else e.status
    end,
    e.weekly_question_limit,
    (
      select count(*)
      from public.mentor_messages message
      where message.thread_id = t.id
        and message.counts_quota
        and message.quota_week = date_trunc('week', now())::date
    ),
    e.starts_at,
    e.ends_at
  from public.mentor_threads t
  join public.mentor_entitlements e on e.id = t.entitlement_id
  join public.mentor_profiles m on m.id = t.mentor_id
  where t.id = p_thread_id
    and (
      t.student_id = auth.uid()
      or m.owner_id = auth.uid()
      or public.mentor_is_admin()
    );
$$;

revoke all on function public.mentor_display_avatar(uuid, text) from public, anon, authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '202609090001'::text;
$$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
