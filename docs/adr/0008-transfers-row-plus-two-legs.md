# 8. A transfer is one row plus two ordinary ledger legs

**Status:** accepted

## Context

A transfer must debit one account and credit another atomically, be visible in both histories, and never exist
half-done.

## Decision

A `transfers` row (own id, `UNIQUE (source_account_id, reference_id)`, `CHECK (source <> destination)`) plus two
normal `transactions` rows, a debit on the source and a credit on the destination, linked by `transfer_id` and sharing
the transfer's `reference_id` and `created_at`. A partial unique index on `(transfer_id, type)` allows at most one
leg of each type. Everything is written in one database transaction through the same `LedgerService` path as plain
transactions. `reference_id` is optional (generated) and must be unused on both accounts.

## Consequences

- Histories, balances, `balance_after` and the reconciliation queries need no special case for transfers.
- `GET /v1/transfers/{id}` can return both legs.
- A transfer with an unaffordable source, a missing account or a clashing reference persists nothing.

## Rejected

- **Legs only, no transfer row:** nothing to address, de-duplicate or constrain.
- **Reference naming such as `transfer:<ref>:debit`:** would need reserved prefixes to avoid collisions with client keys.
- **A distinct "transfer" transaction type:** would break the brief's `credit | debit` model.
