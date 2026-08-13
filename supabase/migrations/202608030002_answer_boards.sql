begin;

-- 问题解答与复盘解答共用现有帖子、评论和审核链路，只扩展允许的板块值。
do $$
declare
  has_unknown boolean;
  has_board_column boolean;
  constraint_row record;
begin
  if to_regclass('public.posts') is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'posts'
      and column_name = 'board'
  ) into has_board_column;
  if not has_board_column then
    return;
  end if;

  select exists (
    select 1
    from public.posts
    where board is not null
      and board not in (
        'public_viewpoint', 'idea_sharing', 'case_submission',
        'question_answers', 'review_answers'
      )
  ) into has_unknown;

  -- 只有在现有数据完全属于已知板块时才更新约束，避免迁移影响历史内容。
  if not has_unknown then
    -- 不依赖旧约束的名字：早期环境可能叫 posts_board_check，
    -- 也可能由 Supabase 生成另一名称。只处理检查 board 枚举值的约束。
    for constraint_row in
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.posts'::regclass
        and contype = 'c'
        and lower(pg_get_constraintdef(oid)) like '%board%'
    loop
      execute format(
        'alter table public.posts drop constraint if exists %I',
        constraint_row.conname
      );
    end loop;

    alter table public.posts
      add constraint posts_board_allowed_check
      check (board is null or board in (
        'public_viewpoint', 'idea_sharing', 'case_submission',
        'question_answers', 'review_answers'
      ));
  end if;
end;
$$;

commit;
