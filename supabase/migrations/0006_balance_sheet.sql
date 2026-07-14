-- ============================================================================
-- Betterservice Tepuke — balance sheet (Phase 2c)
-- Built 14 July 2026. Runs after 0003 (accounts + journal).
-- Owner-gated point-in-time snapshot: Assets, Liabilities, and Equity as at a
-- date, where Equity includes earnings-to-date (income − expenses), so
-- Assets = Liabilities + Equity always holds for a balanced ledger.
-- ============================================================================

create or replace function public.balance_sheet(p_as_of date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Owners only'; end if;

  with lines as (
    select jl.account_id, jl.debit, jl.credit
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    where je.entry_date <= p_as_of
  ),
  bal as (
    select a.code, a.name, a.type, coalesce(sum(l.debit - l.credit), 0) as dc
    from accounts a
    left join lines l on l.account_id = a.id
    group by a.code, a.name, a.type
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', dc) order by code), '[]'::jsonb) from bal where type = 'asset'),
    'assets_total', (select coalesce(sum(dc), 0) from bal where type = 'asset'),
    'liabilities', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -dc) order by code), '[]'::jsonb) from bal where type = 'liability'),
    'liabilities_total', (select coalesce(sum(-dc), 0) from bal where type = 'liability'),
    'equity', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', -dc) order by code), '[]'::jsonb) from bal where type = 'equity'),
    'equity_accounts_total', (select coalesce(sum(-dc), 0) from bal where type = 'equity'),
    'current_earnings', (select coalesce(sum(-dc), 0) from bal where type in ('income', 'expense')),
    'equity_total', (select coalesce(sum(-dc), 0) from bal where type in ('equity', 'income', 'expense')),
    'liabilities_and_equity', (select coalesce(sum(-dc), 0) from bal where type in ('liability', 'equity', 'income', 'expense')),
    'balanced', (select abs(coalesce(sum(case when type = 'asset' then dc else 0 end), 0) - coalesce(sum(case when type in ('liability','equity','income','expense') then -dc else 0 end), 0)) < 0.005 from bal)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end
$function$;

grant execute on function public.balance_sheet(date) to authenticated;
