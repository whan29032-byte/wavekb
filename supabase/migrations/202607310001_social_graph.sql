begin;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_unique_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a <> user_b)
);

create unique index if not exists direct_conversations_unique_pair
  on public.direct_conversations (least(user_a, user_b), greatest(user_a, user_b));

create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists direct_messages_conversation_created
  on public.direct_messages (conversation_id, created_at);

alter table public.friendships enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

create policy "friendships participants can read"
  on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

create policy "conversations participants can read"
  on public.direct_conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));

create policy "messages participants can read"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.direct_conversations conversation
      where conversation.id = conversation_id
        and auth.uid() in (conversation.user_a, conversation.user_b)
    )
  );

create or replace function public.search_profile_by_uid(p_uid integer)
returns table (
  id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  role text,
  display_title text,
  nameplate_style text,
  cover_url text,
  cover_style text
)
language sql
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.public_uid,
    profile.display_name,
    profile.avatar_url,
    profile.bio,
    profile.role,
    profile.display_title,
    profile.nameplate_style,
    profile.cover_url,
    profile.cover_style
  from public.profiles profile
  where profile.public_uid = p_uid
  limit 1;
$$;

create or replace function public.send_friend_request(p_target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  friendship_id uuid;
begin
  if auth.uid() is null or p_target is null or p_target = auth.uid() then
    raise exception 'invalid friend target';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), p_target, 'pending')
  on conflict (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  ) do update
    set status = case
      when friendships.status = 'accepted' then 'accepted'
      else 'pending'
    end,
    requester_id = case
      when friendships.status = 'accepted' then friendships.requester_id
      else auth.uid()
    end,
    addressee_id = case
      when friendships.status = 'accepted' then friendships.addressee_id
      else p_target
    end,
    updated_at = now()
  returning id into friendship_id;

  return friendship_id;
end;
$$;

create or replace function public.respond_friend_request(
  p_friendship uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end,
      updated_at = now()
  where id = p_friendship
    and addressee_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'friend request not found';
  end if;
end;
$$;

create or replace function public.list_my_friendships()
returns table (
  friendship_id uuid,
  status text,
  direction text,
  other_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  bio text,
  role text,
  display_title text,
  nameplate_style text
)
language sql
security definer
set search_path = public
as $$
  select
    friendship.id,
    friendship.status,
    case when friendship.requester_id = auth.uid() then 'outgoing' else 'incoming' end,
    profile.id,
    profile.public_uid,
    profile.display_name,
    profile.avatar_url,
    profile.bio,
    profile.role,
    profile.display_title,
    profile.nameplate_style
  from public.friendships friendship
  join public.profiles profile
    on profile.id = case
      when friendship.requester_id = auth.uid() then friendship.addressee_id
      else friendship.requester_id
    end
  where auth.uid() in (friendship.requester_id, friendship.addressee_id)
    and friendship.status <> 'blocked'
  order by friendship.updated_at desc;
$$;

create or replace function public.open_direct_conversation(p_target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_id uuid;
begin
  if not exists (
    select 1
    from public.friendships friendship
    where least(friendship.requester_id, friendship.addressee_id) = least(auth.uid(), p_target)
      and greatest(friendship.requester_id, friendship.addressee_id) = greatest(auth.uid(), p_target)
      and friendship.status = 'accepted'
  ) then
    raise exception 'accepted friendship required';
  end if;

  insert into public.direct_conversations (user_a, user_b)
  values (auth.uid(), p_target)
  on conflict (
    least(user_a, user_b),
    greatest(user_a, user_b)
  ) do update set updated_at = now()
  returning id into conversation_id;

  return conversation_id;
end;
$$;

create or replace function public.list_my_conversations()
returns table (
  conversation_id uuid,
  other_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  display_title text,
  nameplate_style text,
  last_message text,
  last_message_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    conversation.id,
    profile.id,
    profile.public_uid,
    profile.display_name,
    profile.avatar_url,
    profile.display_title,
    profile.nameplate_style,
    latest.body,
    latest.created_at
  from public.direct_conversations conversation
  join public.profiles profile
    on profile.id = case
      when conversation.user_a = auth.uid() then conversation.user_b
      else conversation.user_a
    end
  left join lateral (
    select message.body, message.created_at
    from public.direct_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest on true
  where auth.uid() in (conversation.user_a, conversation.user_b)
  order by coalesce(latest.created_at, conversation.created_at) desc;
$$;

create or replace function public.list_conversation_messages(p_conversation uuid)
returns table (
  id bigint,
  sender_id uuid,
  body text,
  created_at timestamptz,
  display_name text,
  public_uid integer,
  avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select
    message.id,
    message.sender_id,
    message.body,
    message.created_at,
    profile.display_name,
    profile.public_uid,
    profile.avatar_url
  from public.direct_messages message
  join public.direct_conversations conversation
    on conversation.id = message.conversation_id
  join public.profiles profile on profile.id = message.sender_id
  where message.conversation_id = p_conversation
    and auth.uid() in (conversation.user_a, conversation.user_b)
  order by message.created_at asc
  limit 500;
$$;

create or replace function public.send_direct_message(
  p_conversation uuid,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  message_id bigint;
begin
  if not exists (
    select 1
    from public.direct_conversations conversation
    where conversation.id = p_conversation
      and auth.uid() in (conversation.user_a, conversation.user_b)
  ) then
    raise exception 'conversation not found';
  end if;

  insert into public.direct_messages (conversation_id, sender_id, body)
  values (p_conversation, auth.uid(), btrim(p_body))
  returning id into message_id;

  update public.direct_conversations
  set updated_at = now()
  where id = p_conversation;

  return message_id;
end;
$$;

revoke all on function public.search_profile_by_uid(integer) from public;
revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.list_my_friendships() from public;
revoke all on function public.open_direct_conversation(uuid) from public;
revoke all on function public.list_my_conversations() from public;
revoke all on function public.list_conversation_messages(uuid) from public;
revoke all on function public.send_direct_message(uuid, text) from public;

grant execute on function public.search_profile_by_uid(integer) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.list_my_friendships() to authenticated;
grant execute on function public.open_direct_conversation(uuid) to authenticated;
grant execute on function public.list_my_conversations() to authenticated;
grant execute on function public.list_conversation_messages(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

commit;
