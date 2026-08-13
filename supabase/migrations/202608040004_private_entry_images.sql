create table if not exists public.private_entry_images (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.private_entries(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null default 0 check (sort_order between 0 and 8),
  created_at timestamptz not null default now(),
  check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  )
);

create index if not exists private_entry_images_entry_order_idx
  on public.private_entry_images (entry_id, sort_order);

alter table public.private_entry_images enable row level security;

grant select, insert, delete on public.private_entry_images to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'private_entry_images'
      and policyname = 'private_entry_images_select_own'
  ) then
    create policy private_entry_images_select_own on public.private_entry_images
      for select to authenticated using (owner_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'private_entry_images'
      and policyname = 'private_entry_images_insert_own'
  ) then
    create policy private_entry_images_insert_own on public.private_entry_images
      for insert to authenticated with check (
        owner_id = auth.uid()
        and exists (
          select 1 from public.private_entries entry
          where entry.id = private_entry_images.entry_id
            and entry.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'private_entry_images'
      and policyname = 'private_entry_images_delete_own'
  ) then
    create policy private_entry_images_delete_own on public.private_entry_images
      for delete to authenticated using (owner_id = auth.uid());
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-entry-images',
  'private-entry-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
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
      and policyname = 'private_entry_images_select_own'
  ) then
    create policy private_entry_images_select_own on storage.objects
      for select to authenticated
      using (
        bucket_id = 'private-entry-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'private_entry_images_insert_own'
  ) then
    create policy private_entry_images_insert_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'private-entry-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'private_entry_images_delete_own'
  ) then
    create policy private_entry_images_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'private-entry-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
