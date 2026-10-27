# 4. Pessimistic row locks at READ COMMITTED, no retry loop

**Status:** accepted

## Context

Concurrent requests must not overdraw an account, double-apply a `reference_id`, or deadlock during transfers.

## Decision

One database transaction per write, default `READ COMMITTED`. Inside it:

1. `set_config('lock_timeout' | 'statement_timeout' | 'idle_in_transaction_session_timeout', …, true)` (transaction-local).
2. `SELECT … FROM accounts WHERE id IN (…) ORDER BY id FOR NO KEY UPDATE`. All accounts of the operation are locked in one
   statement, in ascending id order, so no wait-for cycle can form. `NO KEY UPDATE` is the lock an `UPDATE` of a
   non-key column takes anyway, and it does not block the foreign-key checks of concurrent inserts.
3. `SELECT clock_timestamp()` after the lock, used for every row written.
4. Duplicate check, then balance check, both under the lock.
5. `UPDATE accounts SET balance = balance ± amount RETURNING balance`, then `INSERT` with `balance_after`.

`CHECK (balance >= 0)` and `UNIQUE (account_id, reference_id)` remain as backstops: a `23514` becomes `422`, a
`23505` is recovered into the same `409` with the existing row. Lock waits beyond `DB_LOCK_TIMEOUT_MS` become
`409 CONCURRENCY_CONFLICT` with `Retry-After`.

## Consequences

- No retry loop. Deadlocks are impossible by construction and `READ COMMITTED` never raises `40001`; a retry loop would
  be untestable dead code.
- `now()` is wrong here (it is the transaction start, so a waiter could be stamped before the transaction it waited for).
- Verified by mutation: removing the ordered locks makes the opposite-direction transfer test fail with deadlocks.

## Rejected

- **SERIALIZABLE + retry:** needs a retry policy, produces spurious failures under contention, harder to reason about.
- **Optimistic version column:** every conflict becomes a client-visible failure.
- **Advisory locks:** session-scoped locks do not survive transaction pooling (Supabase port 6543).
