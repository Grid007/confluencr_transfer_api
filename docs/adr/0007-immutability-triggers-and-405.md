# 7. Immutability in the database, plus explicit 405s

**Status:** accepted

## Context

"Once a transaction is created it must not be editable or deletable through the API." An API-only guarantee
disappears the moment someone runs SQL or a future endpoint is added.

## Decision

- No mutating routes exist. Other verbs on known resources return `405 METHOD_NOT_ALLOWED` with an `Allow` header,
  checked before the resource is looked up. Unknown paths stay `404`.
- `BEFORE UPDATE OR DELETE` row triggers and `BEFORE TRUNCATE` statement triggers on `transactions` and `transfers`
  raise `restrict_violation` (SQLSTATE `23001`). `accounts` rows cannot be deleted, and only `balance` may change.
  A `BEFORE INSERT` trigger enforces the zero initial balance.
- The triggers use owner-level DDL only, so the identical migration runs on Supabase.

## Consequences

- Tests cannot truncate tables; they create fresh accounts instead (also faster).
- The reconciliation SQL can still detect a hand-edited balance (`balance ≠ Σ ledger`), which a test proves.

## Rejected

- **API-only immutability:** weaker than the brief's "must remain unchanged".
- **`REVOKE UPDATE, DELETE`:** depends on roles that differ between Docker, Supabase and managed Postgres.
- **404 for forbidden verbs:** misleading, since the resource exists.
