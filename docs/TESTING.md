# Testing

## Suites

| Command         | Scope                                                                                                                            | Needs Docker |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `pnpm test`     | Unit: validation grammar, issue mapping, money, pagination, error filter, error catalog                                          | no           |
| `pnpm test:int` | Integration against real PostgreSQL: concurrency, duplicates, atomicity, locking, transfers, constraints, immutability, ordering | yes          |
| `pnpm test:e2e` | The real HTTP stack against real PostgreSQL: every endpoint, every error class, OpenAPI contract                                 | yes          |
| `pnpm test:all` | All of the above                                                                                                                 | yes          |
| `pnpm test:cov` | Everything with V8 coverage (`coverage/`)                                                                                        | yes          |

Nothing that touches SQL is mocked. Anything involving locks, constraints or triggers is tested against a real
Postgres, because that is where the guarantees live.

## How the database is provided

`test/setup/global-setup.ts` starts **one** disposable `postgres:17.11-alpine` container per run
(Testcontainers, data directory on tmpfs), applies the SQL migrations and shares the connection URL with the tests.
On Windows Testcontainers talks to Docker Desktop through the named pipe automatically; use Linux containers.

- No Docker? `TEST_DATABASE_URL=postgres://… pnpm test:int`. The database is migrated and used as is.
- Docker trouble on Windows or in CI: `DEBUG=testcontainers* pnpm test:int`, or `TESTCONTAINERS_RYUK_DISABLED=true`.
- Tests isolate themselves by creating fresh accounts. They never truncate: the immutability triggers forbid it.

## What the headline tests prove

| Guarantee                              | Test                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No overdraft under contention          | 25 parallel debits of 10.00 against 100.00 → exactly 10 succeed, final balance 0.00                                                   |
| No lost updates                        | 50 parallel credits of 1.00 → balance 50.00 and `balance_after` is a permutation of 1..50                                             |
| Duplicates are idempotent under a race | 10 identical parallel posts → 1 row, 9 × 409 all pointing at the same transaction                                                     |
| Atomic create + balance update         | A failure injected after the balance `UPDATE` leaves no row and no balance change                                                     |
| Atomic transfer                        | A failure on the credit leg rolls back the debit leg, the transfer row and both balances                                              |
| No deadlocks                           | 20 transfers A→B racing 20 transfers B→A all succeed; tight-balance variants only 201 or 422                                          |
| Lock waits are bounded                 | A held row lock: the request waits and succeeds; with `lock_timeout` 300 ms it returns 409 fast                                       |
| The UNIQUE backstop works              | Duplicate check disabled → the constraint fires and the API still answers the same 409                                                |
| The database enforces the rules itself | Raw SQL: negative balance, duplicate key, zero amount, bad enum, orphan row, same-account transfer                                    |
| The ledger cannot be edited            | Raw SQL `UPDATE`/`DELETE`/`TRUNCATE` on transactions, transfers and accounts → SQLSTATE 23001                                         |
| Balance always equals the ledger       | `scripts/reconcile.sql` runs after each suite (balance = Σ ledger, `balance_after` chain, transfer legs)                              |
| Documentation cannot drift             | OpenAPI contract test (every operation, every error code, committed `openapi.json`), catalog test (`docs/API.md` mentions every code) |

## Mutation checks that were run

Tests are only as good as their ability to fail. Removing the ordered row locks from `LedgerService.lockAccounts`
was tried on purpose:

- `transfers.int-spec` failed immediately: of 40 opposite-direction transfers only 4 succeeded, 16 returned 409 and
  20 returned 500 (Postgres deadlocks).
- `ledger.concurrency.int-spec` still passed. That is expected and worth knowing: with no lock, `CHECK (balance >= 0)`
  still stops overdrafts and the error mapper turns the violation into the same 422. The lock is what makes
  multi-account operations deadlock-free and keeps timestamps and duplicates deterministic; the constraint is what
  makes the single-account invariant unbreakable. Both layers are intentional.

## Bugs found while building

- `ConfigModule.forRoot` reads the environment once at import time, so per-test environment overrides were silently
  ignored. A health test "for an unreachable database" got `200`, and a lock-timeout test passed for the wrong
  reason (it waited out the default 5 s). Fixed by replacing `ConfigService` in the test app, and by asserting the
  timeout test finishes in under 3 s so it can no longer pass by accident.
- Drizzle generated descending index columns as `DESC NULLS LAST`; Postgres sorts `DESC` as nulls first, so the
  history query could not use the index. The columns are `NOT NULL`, so the clause was removed from the migration.
- The first design for the timestamp read it through a JavaScript `Date` (microseconds truncated) while the account
  default kept microseconds, which could place a transaction before its own account. Both are now truncated to
  milliseconds in SQL.
- Compose's `pg_isready` over the Unix socket reports healthy during the image's temporary init server, before TCP
  is listening. The healthcheck probes `127.0.0.1`, and the migrator retries its first connection.
- pnpm 12's default 24-hour release-age policy rejected four dependencies published the same day. They are pinned to
  the newest release older than 24 hours instead of weakening the policy.
