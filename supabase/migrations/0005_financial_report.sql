-- ============================================================================
-- Betterservice Tepuke — financial report (Phase 2b)
-- Built 14 July 2026; captured into the repo the same day from the live project.
-- Runs after 0003 (accounts + journal) and 0004 (expenses).
-- Owner-gated: Profit & Loss (per income/expense account) + GST return
-- (output vs input vs net) for any date range, straight from the ledger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.financial_report(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Owners only'; end if;

  with period_lines as (
    select jl.account_id, jl.debit, jl.credit
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    where je.entry_date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'income', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'amount', a.amt) order by a.code), '[]'::jsonb)
      from (
        select acc.code, acc.name, coalesce(sum(pl.credit - pl.debit), 0) as amt
        from accounts acc left join period_lines pl on pl.account_id = acc.id
        where acc.type = 'income' group by acc.code, acc.name
      ) a
    ),
    'income_total', (
      select coalesce(sum(pl.credit - pl.debit), 0)
      from period_lines pl join accounts acc on acc.id = pl.account_id where acc.type = 'income'
    ),
    'expenses', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'amount', a.amt) order by a.code), '[]'::jsonb)
      from (
        select acc.code, acc.name, coalesce(sum(pl.debit - pl.credit), 0) as amt
        from accounts acc left join period_lines pl on pl.account_id = acc.id
        where acc.type = 'expense' group by acc.code, acc.name
      ) a
    ),
    'expense_total', (
      select coalesce(sum(pl.debit - pl.credit), 0)
      from period_lines pl join accounts acc on acc.id = pl.account_id where acc.type = 'expense'
    ),
    'net_profit', (
      select coalesce(sum(pl.credit - pl.debit), 0)
      from period_lines pl join accounts acc on acc.id = pl.account_id where acc.type in ('income', 'expense')
    ),
    'gst', (
      select jsonb_build_object(
        'output', coalesce(sum(pl.credit), 0),
        'input', coalesce(sum(pl.debit), 0),
        'net', coalesce(sum(pl.credit - pl.debit), 0)
      )
      from period_lines pl join accounts acc on acc.id = pl.account_id where acc.code = '200'
    )
  ) into result;

  return coalesce(result, '{}'::jsonb);
end
$function$;

grant execute on function public.financial_report(date, date) to authenticated;
