create or replace function public.update_my_post_v3(
  p_post_id uuid,
  p_title text,
  p_body text,
  p_images jsonb,
  p_external_url text,
  p_external_kind text,
  p_chart_package jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_external_url text := nullif(trim(coalesce(p_external_url, '')), '');
  image_count integer := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.account_is_active() then
    raise exception 'account restricted';
  end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id and author_id = auth.uid() and status <> 'hidden'
  ) then
    raise exception 'post not editable';
  end if;
  if char_length(trim(p_title)) not between 5 and 120
     or char_length(trim(p_body)) not between 20 and 20000 then
    raise exception 'invalid post content';
  end if;
  if image_count > 9 then
    raise exception 'too many post images';
  end if;
  if normalized_external_url is not null
     and public.external_reference_kind(normalized_external_url) is distinct from p_external_kind then
    raise exception 'invalid external reference';
  end if;
  if normalized_external_url is null and p_external_kind is not null then
    raise exception 'invalid external reference';
  end if;

  update public.posts
  set
    title = trim(p_title),
    body = trim(p_body),
    external_url = normalized_external_url,
    external_kind = case when normalized_external_url is null then null else p_external_kind end,
    chart_package = p_chart_package
  where id = p_post_id;

  delete from public.post_images where post_id = p_post_id;

  insert into public.post_images(post_id, owner_id, storage_path, sort_order)
  select p_post_id, auth.uid(), item->>'storage_path', ordinality - 1
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
    with ordinality as image(item, ordinality)
  where item->>'storage_path' like auth.uid()::text || '/' || p_post_id::text || '/%';

  if (select count(*) from public.post_images where post_id = p_post_id) <> image_count then
    raise exception 'invalid post image path';
  end if;
end;
$$;

revoke all on function public.update_my_post_v3(
  uuid, text, text, jsonb, text, text, jsonb
) from public, anon;
grant execute on function public.update_my_post_v3(
  uuid, text, text, jsonb, text, text, jsonb
) to authenticated;
