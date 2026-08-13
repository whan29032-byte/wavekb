alter table public.posts drop constraint if exists posts_board_check;
alter table public.posts
  add constraint posts_board_check
    check (board in ('case_submission', 'idea_sharing', 'public_viewpoint')),
  add column if not exists summary text not null default ''
    check (char_length(summary) <= 500),
  add column if not exists tags text[] not null default '{}'
    check (cardinality(tags) <= 12),
  add column if not exists knowledge_ids text[] not null default '{}'
    check (cardinality(knowledge_ids) <= 24),
  add column if not exists comments_enabled boolean not null default true;

drop policy if exists "verified sessions create own posts" on public.posts;
create policy "verified sessions create own posts"
on public.posts for insert to authenticated
with check (
  author_id = auth.uid()
  and status = 'draft'
  and public.is_verified_user()
);

create table public.private_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('review', 'journal', 'draft')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 50000),
  instrument text not null default '' check (char_length(instrument) <= 80),
  market text not null default '' check (char_length(market) <= 80),
  timeframe text not null default '' check (char_length(timeframe) <= 40),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  knowledge_ids text[] not null default '{}' check (cardinality(knowledge_ids) <= 40),
  workbench_analysis_id uuid,
  review_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index private_entries_owner_updated_idx
on public.private_entries(owner_id, updated_at desc)
where deleted_at is null;

create trigger private_entries_touch_updated_at
before update on public.private_entries
for each row execute function public.touch_updated_at();

alter table public.private_entries enable row level security;

create policy "owners read private entries"
on public.private_entries for select to authenticated
using (owner_id = auth.uid());

create policy "owners create private entries"
on public.private_entries for insert to authenticated
with check (owner_id = auth.uid());

create policy "owners update private entries"
on public.private_entries for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "owners delete private entries"
on public.private_entries for delete to authenticated
using (owner_id = auth.uid());

create table public.post_sources (
  post_id uuid primary key references public.posts(id) on delete cascade,
  private_entry_id uuid not null references public.private_entries(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.post_sources enable row level security;

create policy "owners read private post sources"
on public.post_sources for select to authenticated
using (owner_id = auth.uid());

create policy "owners create private post sources"
on public.post_sources for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.private_entries
    where private_entries.id = private_entry_id
      and private_entries.owner_id = auth.uid()
  )
  and exists (
    select 1
    from public.posts
    where posts.id = post_id
      and posts.author_id = auth.uid()
      and posts.status = 'draft'
  )
);

create policy "owners delete private post sources"
on public.post_sources for delete to authenticated
using (owner_id = auth.uid());
