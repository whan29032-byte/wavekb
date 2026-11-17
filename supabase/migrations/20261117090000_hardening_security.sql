-- 增量硬化：开 RLS、收 anon 写权限、暴露公开会员方案视图。
-- 原则：幂等、不 drop 任何对象；所有对象先 to_regclass 守卫，重复执行安全。

-- 1) 对「anon 与 authenticated 都没有表权限」的业务表开启 RLS。
--    这些表本来就只由 service_role / owner 访问，开启 RLS 不改变任何既有读路径。
do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as rel
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
      and not has_table_privilege('anon', c.oid, 'SELECT')
      and not has_table_privilege('authenticated', c.oid, 'SELECT')
  loop
    execute format('alter table %s enable row level security', t.rel);
  end loop;
end $$;

-- 2) 匿名角色不得写入社区表（读权限不动，由既有策略决定可见性）。
do $$
begin
  if to_regclass('public.posts') is not null then
    execute 'revoke insert, update, delete, truncate on public.posts from anon';
  end if;
  if to_regclass('public.post_comments') is not null then
    execute 'revoke insert, update, delete, truncate on public.post_comments from anon';
  end if;
end $$;

-- 3) 公开读策略：只在缺失时重建（posts 没有 visibility 列，不要引用它）。
do $$
begin
  if to_regclass('public.posts') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'posts'
      and policyname = 'published or owned posts are readable'
  ) then
    execute $policy$
      create policy "published or owned posts are readable" on public.posts
      for select using (status = 'published' or author_id = auth.uid() or public.is_admin())
    $policy$;
  end if;
end $$;

-- 4) 公开会员方案视图：只投影三列，只给已启用的方案。
--    不加 security_invoker —— membership 迁移已把基础表对 anon 全撤权，
--    视图需要以属主身份读取，否则匿名拿不到任何行。
do $$
begin
  if to_regclass('public.membership_plans') is null then
    return;
  end if;
  if to_regclass('public.public_membership_plans') is null then
    execute 'create view public.public_membership_plans as
               select key, title, description
               from public.membership_plans
               where enabled';
  end if;
  execute 'grant select on public.public_membership_plans to anon, authenticated';
end $$;

-- 5) 迁移标记：与既有迁移一致，把库内版本号推进到本次迁移时间戳。
create or replace function public.wavekb_schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select '20261117090000'::text; $$;
