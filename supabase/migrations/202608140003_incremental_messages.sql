create or replace function public.list_conversation_messages_after(
  p_conversation uuid,
  p_after_id bigint
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
set search_path = ''
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
  join public.friendships friendship
    on friendship.status = 'accepted'
   and least(friendship.requester_id, friendship.addressee_id)
       = least(conversation.user_a, conversation.user_b)
   and greatest(friendship.requester_id, friendship.addressee_id)
       = greatest(conversation.user_a, conversation.user_b)
  join public.profiles profile on profile.id = message.sender_id
  where message.conversation_id = p_conversation
    and message.id > greatest(coalesce(p_after_id, 0), 0)
    and auth.uid() in (conversation.user_a, conversation.user_b)
  order by message.id asc
  limit 100;
$$;

revoke all on function public.list_conversation_messages_after(uuid, bigint) from public, anon;
grant execute on function public.list_conversation_messages_after(uuid, bigint) to authenticated;
