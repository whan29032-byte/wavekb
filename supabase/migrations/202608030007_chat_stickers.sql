create table if not exists public.chat_stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  label text not null default '自定义表情' check (char_length(label) between 1 and 40),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  created_at timestamptz not null default now(),
  check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|gif|webp)$')
);

alter table public.chat_stickers enable row level security;

grant select, insert, delete on public.chat_stickers to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_stickers'
      and policyname = 'chat_stickers_select_own'
  ) then
    create policy chat_stickers_select_own on public.chat_stickers
      for select to authenticated using (owner_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_stickers'
      and policyname = 'chat_stickers_insert_own'
  ) then
    create policy chat_stickers_insert_own on public.chat_stickers
      for insert to authenticated with check (owner_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_stickers'
      and policyname = 'chat_stickers_delete_own'
  ) then
    create policy chat_stickers_delete_own on public.chat_stickers
      for delete to authenticated using (owner_id = auth.uid());
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-stickers',
  'chat-stickers',
  true,
  12582912,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat_stickers_insert_own'
  ) then
    create policy chat_stickers_insert_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'chat-stickers'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'chat_stickers_delete_own'
  ) then
    create policy chat_stickers_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'chat-stickers'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
