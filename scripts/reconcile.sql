-- Ledger reconciliation queries. Every query must return ZERO rows on a consistent ledger.
-- Shared by `pnpm db:reconcile` and the test helpers so ops and tests agree on "consistent".

-- name: balance_matches_ledger
-- accounts.balance must equal the sum of its credits minus its debits.
select a.id as account_id,
       a.balance,
       coalesce(sum(case t.type when 'credit' then t.amount else -t.amount end), 0) as ledger_balance
  from accounts a
  left join transactions t on t.account_id = a.id
 group by a.id, a.balance
having a.balance <> coalesce(sum(case t.type when 'credit' then t.amount else -t.amount end), 0);

-- name: balance_after_chain
-- Each entry's balance_after must equal the previous entry's balance_after plus its signed amount.
-- Ordered by seq (insertion order, serialised per account by the row lock), never by wall clock.
select x.id, x.account_id, x.balance_after, x.expected
  from (
        select t.id,
               t.account_id,
               t.balance_after,
               coalesce(lag(t.balance_after) over w, 0)
                 + case t.type when 'credit' then t.amount else -t.amount end as expected
          from transactions t
        window w as (partition by t.account_id order by t.seq)
       ) x
 where x.balance_after <> x.expected;

-- name: transfer_legs_complete
-- Every transfer has exactly one matching debit leg and one matching credit leg.
select tr.id as transfer_id
  from transfers tr
  left join transactions t on t.transfer_id = tr.id
 group by tr.id, tr.amount, tr.source_account_id, tr.destination_account_id
having count(*) filter (where t.type = 'debit'
                          and t.amount = tr.amount
                          and t.account_id = tr.source_account_id) <> 1
    or count(*) filter (where t.type = 'credit'
                          and t.amount = tr.amount
                          and t.account_id = tr.destination_account_id) <> 1;
