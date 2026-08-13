begin;

-- 导师服务统一以 USDT 报价；仅修正币种标识，不自动换算历史数值。
alter table public.mentor_offers drop constraint if exists mentor_offers_currency_check;
alter table public.mentor_offers add constraint mentor_offers_currency_check
  check (currency = 'USDT' or char_length(currency) = 3);
alter table public.mentor_orders drop constraint if exists mentor_orders_currency_check;
alter table public.mentor_orders add constraint mentor_orders_currency_check
  check (currency = 'USDT' or char_length(currency) = 3);
alter table public.mentor_offers alter column currency set default 'USDT';
alter table public.mentor_orders alter column currency set default 'USDT';
update public.mentor_offers set currency = 'USDT' where currency <> 'USDT';
update public.mentor_orders set currency = 'USDT' where currency <> 'USDT' and status = 'pending';

commit;
