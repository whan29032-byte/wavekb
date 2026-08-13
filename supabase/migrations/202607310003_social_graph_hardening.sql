begin;

-- Keep pair and message lookups bounded as the social graph grows.
create index if not exists friendships_accepted_pair_lookup_idx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status = 'accepted';

create index if not exists direct_conversations_user_a_updated_idx
  on public.direct_conversations (user_a, updated_at desc);

create index if not exists direct_conversations_user_b_updated_idx
  on public.direct_conversations (user_b, updated_at desc);

create index if not exists direct_messages_conversation_created_id_desc_idx
  on public.direct_messages (conversation_id, created_at desc, id desc);

create index if not exists direct_messages_unread_conversation_idx
  on public.direct_messages (conversation_id, sender_id, created_at desc, id desc)
  where read_at is null;

-- A reverse pending request means both users have expressed intent to connect.
-- Preserve the original direction and accept the relationship; never flip it.
create or replace function public.send_friend_request(p_target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  friendship_id uuid;
  friendship_status text;
begin
  if current_user_id is null
    or p_target is null
    or p_target = current_user_id
  then
    raise exception 'invalid friend target';
  end if;

  insert into public.friendships (
    requester_id,
    addressee_id,
    status
  )
  values (current_user_id, p_target, 'pending')
  on conflict (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  ) do update
    set status = case
      when friendships.status in ('accepted', 'blocked')
        then friendships.status
      when friendships.status = 'pending'
        and friendships.requester_id = excluded.addressee_id
        and friendships.addressee_id = excluded.requester_id
        then 'accepted'
      else 'pending'
    end,
    requester_id = case
      when friendships.status in ('accepted', 'blocked', 'pending')
        then friendships.requester_id
      else excluded.requester_id
    end,
    addressee_id = case
      when friendships.status in ('accepted', 'blocked', 'pending')
        then friendships.addressee_id
      else excluded.addressee_id
    end,
    updated_at = case
      when friendships.status in ('accepted', 'blocked')
        then friendships.updated_at
      else now()
    end
  returning id, status
  into friendship_id, friendship_status;

  if friendship_status = 'blocked' then
    raise exception 'friendship blocked';
  end if;

  return friendship_id;
end;
$$;

-- Conversations remain visible only while the corresponding friendship is
-- accepted. This prevents stale conversations surviving a block or decline.
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
  join public.friendships friendship
    on friendship.status = 'accepted'
   and least(friendship.requester_id, friendship.addressee_id)
       = least(conversation.user_a, conversation.user_b)
   and greatest(friendship.requester_id, friendship.addressee_id)
       = greatest(conversation.user_a, conversation.user_b)
  join public.profiles profile
    on profile.id = case
      when conversation.user_a = auth.uid() then conversation.user_b
      else conversation.user_a
    end
  left join lateral (
    select message.body, message.created_at
    from public.direct_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  where auth.uid() in (conversation.user_a, conversation.user_b)
  order by coalesce(latest.created_at, conversation.created_at) desc;
$$;

-- V2 adds unread counts without changing the V1 return contract used by the
-- current frontend.
create or replace function public.list_my_conversations_v2()
returns table (
  conversation_id uuid,
  other_id uuid,
  public_uid integer,
  display_name text,
  avatar_url text,
  display_title text,
  nameplate_style text,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
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
    latest.created_at,
    coalesce(unread.unread_count, 0)::bigint
  from public.direct_conversations conversation
  join public.friendships friendship
    on friendship.status = 'accepted'
   and least(friendship.requester_id, friendship.addressee_id)
       = least(conversation.user_a, conversation.user_b)
   and greatest(friendship.requester_id, friendship.addressee_id)
       = greatest(conversation.user_a, conversation.user_b)
  join public.profiles profile
    on profile.id = case
      when conversation.user_a = auth.uid() then conversation.user_b
      else conversation.user_a
    end
  left join lateral (
    select message.body, message.created_at
    from public.direct_messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.direct_messages message
    where message.conversation_id = conversation.id
      and message.sender_id <> auth.uid()
      and message.read_at is null
  ) unread on true
  where auth.uid() in (conversation.user_a, conversation.user_b)
  order by coalesce(latest.created_at, conversation.created_at) desc;
$$;

-- Select the newest 500 messages first, then present that window in normal
-- chronological order.
create or replace function public.list_conversation_messages(
  p_conversation uuid
)
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
  with latest_messages as (
    select
      message.id,
      message.sender_id,
      message.body,
      message.created_at
    from public.direct_messages message
    join public.direct_conversations conversation
      on conversation.id = message.conversation_id
    join public.friendships friendship
      on friendship.status = 'accepted'
     and least(friendship.requester_id, friendship.addressee_id)
         = least(conversation.user_a, conversation.user_b)
     and greatest(friendship.requester_id, friendship.addressee_id)
         = greatest(conversation.user_a, conversation.user_b)
    where message.conversation_id = p_conversation
      and auth.uid() in (conversation.user_a, conversation.user_b)
    order by message.created_at desc, message.id desc
    limit 500
  )
  select
    latest.id,
    latest.sender_id,
    latest.body,
    latest.created_at,
    profile.display_name,
    profile.public_uid,
    profile.avatar_url
  from latest_messages latest
  join public.profiles profile on profile.id = latest.sender_id
  order by latest.created_at asc, latest.id asc;
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
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_body is null
    or char_length(btrim(p_body)) not between 1 and 4000
  then
    raise exception 'invalid message body';
  end if;

  if not exists (
    select 1
    from public.direct_conversations conversation
    join public.friendships friendship
      on friendship.status = 'accepted'
     and least(friendship.requester_id, friendship.addressee_id)
         = least(conversation.user_a, conversation.user_b)
     and greatest(friendship.requester_id, friendship.addressee_id)
         = greatest(conversation.user_a, conversation.user_b)
    where conversation.id = p_conversation
      and auth.uid() in (conversation.user_a, conversation.user_b)
  ) then
    raise exception 'accepted friendship required';
  end if;

  insert into public.direct_messages (
    conversation_id,
    sender_id,
    body
  )
  values (p_conversation, auth.uid(), btrim(p_body))
  returning id into message_id;

  update public.direct_conversations
  set updated_at = now()
  where id = p_conversation;

  return message_id;
end;
$$;

create or replace function public.mark_conversation_read_v1(
  p_conversation uuid,
  p_through_id bigint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_through_id is null then
    raise exception 'read boundary required';
  end if;

  if not exists (
    select 1
    from public.direct_conversations conversation
    join public.friendships friendship
      on friendship.status = 'accepted'
     and least(friendship.requester_id, friendship.addressee_id)
         = least(conversation.user_a, conversation.user_b)
     and greatest(friendship.requester_id, friendship.addressee_id)
         = greatest(conversation.user_a, conversation.user_b)
    where conversation.id = p_conversation
      and auth.uid() in (conversation.user_a, conversation.user_b)
  ) then
    raise exception 'accepted friendship required';
  end if;

  update public.direct_messages
  set read_at = now()
  where conversation_id = p_conversation
    and sender_id <> auth.uid()
    and id <= p_through_id
    and read_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- Direct table reads follow the same accepted-friendship boundary as the RPCs.
drop policy if exists "conversations participants can read"
  on public.direct_conversations;

create policy "conversations participants can read"
  on public.direct_conversations for select to authenticated
  using (
    auth.uid() in (user_a, user_b)
    and exists (
      select 1
      from public.friendships friendship
      where friendship.status = 'accepted'
        and least(friendship.requester_id, friendship.addressee_id)
            = least(user_a, user_b)
        and greatest(friendship.requester_id, friendship.addressee_id)
            = greatest(user_a, user_b)
    )
  );

drop policy if exists "messages participants can read"
  on public.direct_messages;

create policy "messages participants can read"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1
      from public.direct_conversations conversation
      join public.friendships friendship
        on friendship.status = 'accepted'
       and least(friendship.requester_id, friendship.addressee_id)
           = least(conversation.user_a, conversation.user_b)
       and greatest(friendship.requester_id, friendship.addressee_id)
           = greatest(conversation.user_a, conversation.user_b)
      where conversation.id = conversation_id
        and auth.uid() in (conversation.user_a, conversation.user_b)
    )
  );

revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.list_my_conversations() from public;
revoke all on function public.list_my_conversations_v2() from public;
revoke all on function public.list_conversation_messages(uuid) from public;
revoke all on function public.send_direct_message(uuid, text) from public;
revoke all on function public.mark_conversation_read_v1(uuid, bigint) from public;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.list_my_conversations() to authenticated;
grant execute on function public.list_my_conversations_v2() to authenticated;
grant execute on function public.list_conversation_messages(uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read_v1(uuid, bigint) to authenticated;

comment on function public.list_my_conversations_v2()
  is 'Lists accepted-friend conversations with per-user unread counts.';

comment on function public.mark_conversation_read_v1(uuid, bigint)
  is 'Marks unread messages from the other accepted friend through the last message ID actually observed by the caller.';

commit;
