create or replace function public.list_my_mentor_students()
returns table (
  thread_id uuid,
  student_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  display_title text,
  nameplate_style text,
  access_status text,
  last_message text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    thread.id,
    student.id,
    student.public_uid,
    student.display_name,
    student.avatar_url,
    student.bio,
    student.display_title,
    student.nameplate_style,
    case
      when entitlement.status = 'active' and entitlement.ends_at > now() then 'active'
      when entitlement.status = 'active' then 'expired'
      else entitlement.status
    end,
    latest.body,
    latest.created_at
  from public.mentor_threads thread
  join public.mentor_profiles mentor on mentor.id = thread.mentor_id
  join public.mentor_entitlements entitlement on entitlement.id = thread.entitlement_id
  join public.profiles student on student.id = thread.student_id
  left join lateral (
    select message.body, message.created_at
    from public.mentor_messages message
    where message.thread_id = thread.id
    order by message.created_at desc
    limit 1
  ) latest on true
  -- 个人消息窗口只能读取当前账号自己名下的学员。
  -- 管理员的全站管理能力保留在独立后台，不能混入个人好友窗口。
  where mentor.owner_id = auth.uid()
  order by coalesce(latest.created_at, thread.updated_at) desc;
$$;

revoke all on function public.list_my_mentor_students() from public;
grant execute on function public.list_my_mentor_students() to authenticated;
