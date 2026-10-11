begin;

-- Immutable, private image evidence. UI keeps only IDs in step_data; download
-- URLs, image bytes, OCR and provider credentials never belong in this table.
create unique index workbench_analyses_id_owner_image_binding_idx on public.workbench_analyses(id,owner_id);
create table public.wave_analysis_images (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_id uuid not null,
  step smallint not null check (step between 2 and 7),
  instrument text not null check (length(btrim(instrument)) between 1 and 80),
  timeframe text not null check (length(btrim(timeframe)) between 1 and 80),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  created_at timestamptz not null default now(),
  foreign key (analysis_id,owner_id) references public.workbench_analyses(id,owner_id) on delete cascade,
  check (storage_path = owner_id::text || '/' || analysis_id::text || '/' || id::text ||
    case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' end)
);
create index wave_analysis_images_owner_idx on public.wave_analysis_images(owner_id);
create index wave_analysis_images_analysis_context_idx on public.wave_analysis_images(analysis_id,step,instrument,timeframe);
alter table public.wave_analysis_images enable row level security;
alter table public.wave_analysis_images force row level security;
revoke all on public.wave_analysis_images from public,anon,authenticated,service_role;
grant select,insert on public.wave_analysis_images to authenticated,service_role;

create function public.guard_wave_analysis_image_insert() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- The lock serializes quotas even across concurrent tabs and contexts. No
  -- network operation is performed while holding it.
  perform 1 from public.workbench_analyses a where a.id=new.analysis_id and a.owner_id=new.owner_id
    and a.instrument=new.instrument and a.primary_timeframe=new.timeframe for update;
  if not found then raise exception 'wave_analysis_image_context_invalid'; end if;
  if (select count(*) from public.wave_analysis_images i where i.analysis_id=new.analysis_id) >= 72
    or (select count(*) from public.wave_analysis_images i where i.analysis_id=new.analysis_id and i.step=new.step
      and i.instrument=new.instrument and i.timeframe=new.timeframe) >= 12 then raise exception 'wave_analysis_image_quota_exceeded'; end if;
  return new;
end;
$$;
revoke all on function public.guard_wave_analysis_image_insert() from public,anon,authenticated,service_role;
grant execute on function public.guard_wave_analysis_image_insert() to authenticated,service_role;
create trigger wave_analysis_image_insert_guard before insert on public.wave_analysis_images
  for each row execute function public.guard_wave_analysis_image_insert();

create policy wave_analysis_images_select_own on public.wave_analysis_images for select to authenticated using (
  owner_id=(select auth.uid()) and exists(select 1 from public.workbench_analyses a where a.id=analysis_id and a.owner_id=(select auth.uid()))
);
create policy wave_analysis_images_insert_own on public.wave_analysis_images for insert to authenticated with check (
  (select public.account_is_active()) and owner_id=(select auth.uid()) and exists(select 1 from public.workbench_analyses a where a.id=analysis_id and a.owner_id=(select auth.uid())
    and a.instrument=wave_analysis_images.instrument and a.primary_timeframe=wave_analysis_images.timeframe)
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('wave-analysis-images','wave-analysis-images',false,2097152,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy wave_analysis_images_storage_select_own on storage.objects for select to authenticated using (
  bucket_id='wave-analysis-images' and exists(select 1 from public.wave_analysis_images i
    join public.workbench_analyses a on a.id=i.analysis_id and a.owner_id=i.owner_id
    where i.storage_path=name and i.owner_id=(select auth.uid()))
);
create policy wave_analysis_images_storage_insert_own on storage.objects for insert to authenticated with check (
  bucket_id='wave-analysis-images' and (select public.account_is_active()) and exists(select 1 from public.wave_analysis_images i
    join public.workbench_analyses a on a.id=i.analysis_id and a.owner_id=i.owner_id
    where i.storage_path=name and i.owner_id=(select auth.uid())
      and a.instrument=i.instrument and a.primary_timeframe=i.timeframe)
);
-- Defense in depth against older broad storage policies. Other buckets retain
-- their existing policies; this bucket always requires immutable owner metadata.
create policy wave_analysis_images_storage_select_bound on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'wave-analysis-images' or exists(select 1 from public.wave_analysis_images i
    join public.workbench_analyses a on a.id=i.analysis_id and a.owner_id=i.owner_id
    where i.storage_path=name and i.owner_id=(select auth.uid()))
);
create policy wave_analysis_images_storage_insert_bound on storage.objects as restrictive for insert to authenticated with check (
  bucket_id<>'wave-analysis-images' or ((select public.account_is_active()) and exists(select 1 from public.wave_analysis_images i
    join public.workbench_analyses a on a.id=i.analysis_id and a.owner_id=i.owner_id
    where i.storage_path=name and i.owner_id=(select auth.uid())
      and a.instrument=i.instrument and a.primary_timeframe=i.timeframe))
);
create policy wave_analysis_images_storage_anon_no_select on storage.objects as restrictive for select to anon using(bucket_id<>'wave-analysis-images');
create policy wave_analysis_images_storage_anon_no_insert on storage.objects as restrictive for insert to anon with check(bucket_id<>'wave-analysis-images');
-- Restrictive policies also prevent another permissive storage policy from
-- accidentally enabling overwrite/deletion of this evidence bucket.
create policy wave_analysis_images_storage_no_update on storage.objects as restrictive for update to anon,authenticated
  using(bucket_id<>'wave-analysis-images') with check(bucket_id<>'wave-analysis-images');
create policy wave_analysis_images_storage_no_delete on storage.objects as restrictive for delete to anon,authenticated
  using(bucket_id<>'wave-analysis-images');

create or replace function public.wavekb_schema_version() returns text language sql stable security invoker set search_path='' as $$ select '20261011001354'; $$;
revoke all on function public.wavekb_schema_version() from public,anon,authenticated,service_role;
grant execute on function public.wavekb_schema_version() to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
