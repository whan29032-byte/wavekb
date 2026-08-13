begin;

-- 只增加回撤结果字段；已有分析、规则、风险和复盘记录不做删除或重写。
do $$
begin
  if to_regclass('public.workbench_analyses') is not null then
    alter table public.workbench_analyses
      add column if not exists drawdown_result jsonb not null default '{}'::jsonb;
  end if;
end;
$$;

commit;
