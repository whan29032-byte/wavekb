create or replace function public.save_private_entry_v2(
  p_entry_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_instrument text,
  p_market text,
  p_timeframe text,
  p_tags text[],
  p_knowledge_ids text[],
  p_review_data jsonb,
  p_images jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_count integer := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'account restricted';
  end if;
  if exists (select 1 from public.private_entries where id = p_entry_id and owner_id <> auth.uid()) then
    raise exception 'entry not editable';
  end if;
  if image_count > 9 then raise exception 'too many entry images'; end if;

  insert into public.private_entries (
    id, owner_id, kind, title, body, instrument, market, timeframe,
    tags, knowledge_ids, review_data, deleted_at
  ) values (
    p_entry_id, auth.uid(), p_kind, trim(p_title), p_body,
    p_instrument, p_market, p_timeframe, coalesce(p_tags, '{}'),
    coalesce(p_knowledge_ids, '{}'), coalesce(p_review_data, '{}'::jsonb), null
  )
  on conflict (id) do update set
    kind = excluded.kind,
    title = excluded.title,
    body = excluded.body,
    instrument = excluded.instrument,
    market = excluded.market,
    timeframe = excluded.timeframe,
    tags = excluded.tags,
    knowledge_ids = excluded.knowledge_ids,
    review_data = excluded.review_data,
    deleted_at = null
  where public.private_entries.owner_id = auth.uid();

  delete from public.private_entry_images where entry_id = p_entry_id and owner_id = auth.uid();
  insert into public.private_entry_images(entry_id, owner_id, storage_path, sort_order)
  select p_entry_id, auth.uid(), item->>'storage_path', ordinality - 1
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
    with ordinality as image(item, ordinality)
  where item->>'storage_path' like auth.uid()::text || '/' || p_entry_id::text || '/%';

  if (select count(*) from public.private_entry_images where entry_id = p_entry_id) <> image_count then
    raise exception 'invalid entry image path';
  end if;
end;
$$;

revoke all on function public.save_private_entry_v2(
  uuid, text, text, text, text, text, text, text[], text[], jsonb, jsonb
) from public, anon;
grant execute on function public.save_private_entry_v2(
  uuid, text, text, text, text, text, text, text[], text[], jsonb, jsonb
) to authenticated;

create or replace function public.wavekb_schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '202608140005'::text $$;

revoke all on function public.wavekb_schema_version() from public;
grant execute on function public.wavekb_schema_version() to anon, authenticated;
