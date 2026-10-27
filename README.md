# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credits and debits, read balances and
paginated history, and move money between accounts atomically. Built for the Walnut Folks Group /
Confluencr Full Stack Developer assessment.

**Stack:** NestJS 12 (TypeScript 6, ESM) · PostgreSQL 17 · Drizzle ORM · Zod 4 · Vitest · Testcontainers ·
Docker Compose · GitHub Actions. The same code runs against a local Postgres or a Supabase project by
changing `DATABASE_URL` (see [docs/SUPABASE.md](docs/SUPABASE.md)).

## Run it

**Zero toolchain, just Docker** (starts Postgres, applies migrations, starts the API):

```bash
docker compose --profile full up --build -d --wait
curl localhost:3000/health          # {"status":"ok", ...}
open http://localhost:3000/docs     # Swagger UI
node scripts/demo.mjs               # replays every worked example from the brief (needs Node 22.22+)
docker compose --profile full down -v
```

**Developer loop** (Node 22.22+ or 24 LTS, pnpm 12, Docker):

```bash
npm install -g pnpm@12.15.0          # pnpm 9/10 refuse this repo's packageManager field, by design
docker compose up -d db              # Postgres 17 on :5432
pnpm install
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
pnpm db:migrate
pnpm start:dev                       # http://localhost:3000/docs
```

## The 15-minute reviewer path

1. `docker compose --profile full up --build -d --wait`, then `node scripts/demo.mjs`. It prints the brief's
   examples (0 +100 +50 −30 −20 = 100, debit 150 on 100 rejected, duplicate `reference_id` → 409, transfer
   30 → 70/80) and asserts each one.
2. Open `/docs` and try the endpoints. Every error response has a named example.
3. `pnpm test:all` (needs Docker). Read [test/integration/transfers.int-spec.ts](test/integration/transfers.int-spec.ts)
   and [test/integration/ledger.concurrency.int-spec.ts](test/integration/ledger.concurrency.int-spec.ts) first.
4. Skim [ASSUMPTIONS.md](ASSUMPTIONS.md) and [docs/adr/](docs/adr), which record what was decided, and what was rejected, and why.

## Requirement → mechanism → proof

| Brief requirement                                     | Enforced by                                                                                                                                     | Proven by                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Initial balance is always 0; client cannot set it     | Strict request schema rejects `balance` (400); insert never names the column; `BEFORE INSERT` trigger rejects non-zero balances                 | `accounts.e2e-spec`, `db.constraints.int-spec`                                                              |
| Debit rejected when balance is insufficient           | Exact decimal check under the row lock (422); `CHECK (balance >= 0)` as backstop                                                                | `spec-examples.e2e-spec`, `ledger.concurrency.int-spec` (25 parallel debits → exactly 10 OK)                |
| Duplicate `reference_id` per account: no new row      | Check under the row lock → 409 with the existing transaction; `UNIQUE (account_id, reference_id)` as backstop; same key allowed across accounts | `ledger.duplicates.int-spec` (10 parallel identical → 1 row, 9 × 409)                                       |
| Transactions are immutable                            | No update/delete routes (405 + `Allow`); `BEFORE UPDATE/DELETE/TRUNCATE` triggers reject even direct SQL                                        | `db.immutability.int-spec`, `transactions.e2e-spec`                                                         |
| Balance always equals the sum of valid transactions   | One code path (`LedgerService`) updates the balance in SQL and appends a row with `balance_after`; rejected requests write nothing              | `scripts/reconcile.sql` runs after every suite and via `pnpm db:reconcile`                                  |
| Create transaction + update balance are one atomic op | One database transaction per request; any failure rolls back both                                                                               | `ledger.atomicity.int-spec` (fault injected after the balance UPDATE)                                       |
| Transfer is atomic, no partial transfer               | Both accounts locked in ascending id order; transfer row + both legs in one transaction                                                         | `transfers.int-spec` (credit leg fails → everything rolled back; 40 racing opposite transfers, no deadlock) |
| Latest first, filter, page/limit, totals              | `ORDER BY created_at DESC, seq DESC` over an ordered index; `count(*) OVER()` gives rows and total from one snapshot                            | `history.e2e-spec`, `history.ordering.int-spec`                                                             |
| Consistent, meaningful errors                         | One error envelope for every failure, including framework and body-parser errors; stable `code`s                                                | `errors.e2e-spec`, `error-catalog.spec`                                                                     |

## API at a glance

Money is a JSON **string** with two decimals (`"150.00"`). Amounts may be sent as a number or a numeric string.
Full reference with examples: [docs/API.md](docs/API.md) · OpenAPI: [docs/openapi.json](docs/openapi.json) (also served at `/docs-json`).

| Method | Path                             | Success | Purpose                                     |
| ------ | -------------------------------- | ------- | ------------------------------------------- |
| POST   | `/v1/accounts`                   | 201     | Create an account (`{ "name" }` only)       |
| GET    | `/v1/accounts/{id}`              | 200     | Fetch an account                            |
| GET    | `/v1/accounts/{id}/balance`      | 200     | `{ account_id, balance }`                   |
| GET    | `/v1/accounts/{id}/transactions` | 200     | History: `?type=credit\|debit&page=&limit=` |
| POST   | `/v1/transactions`               | 201     | Add a credit or debit                       |
| GET    | `/v1/transactions/{id}`          | 200     | Fetch one transaction                       |
| POST   | `/v1/transfers`                  | 201     | Bonus: atomic transfer between two accounts |
| GET    | `/v1/transfers/{id}`             | 200     | Fetch a transfer with both legs             |
| GET    | `/health`, `/docs`, `/docs-json` | 200     | Readiness, Swagger UI, OpenAPI document     |

Every error looks like this, whatever produced it:

```json
{
  "error": {
    "status": 422,
    "code": "INSUFFICIENT_BALANCE",
    "message": "Debit of 150.00 exceeds available balance of 100.00",
    "context": {
      "account_id": "…",
      "balance": "100.00",
      "requested_amount": "150.00",
      "shortfall": "50.00"
    },
    "request_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "timestamp": "2026-10-27T09:12:33.421Z",
    "path": "/v1/transactions"
  }
}
```

## How it works

- **One money path.** `LedgerService` is the only code that changes a balance. Plain transactions and
  transfers both go through it: lock the account row(s) `FOR NO KEY UPDATE` in ascending id order →
  read `clock_timestamp()` _after_ the lock → duplicate check → balance check → `UPDATE accounts SET balance =
balance ± amount` in SQL → insert the immutable row with `balance_after`. No money arithmetic happens in JavaScript.
- **Defence in depth.** The service enforces the rules; the database enforces them again with `CHECK`,
  `UNIQUE`, foreign keys and triggers, so a bug or a hand-written SQL statement cannot corrupt the ledger.
  (The concurrency suite shows both layers working; removing the lock makes the transfer suite deadlock.)
- **Exact money.** `NUMERIC(19,2)` in Postgres, strict decimal parsing at the edge, more than two decimals is
  rejected rather than rounded, strings on the wire.
- **Deterministic history.** `created_at` comes from the database clock at the moment the lock was held, and
  an identity `seq` breaks ties, so "latest first" is the real posting order.
- **Operations.** Structured JSON logs with a request id, graceful shutdown, a readiness endpoint that also
  detects a role that cannot see the ledger tables, lock and statement timeouts (a stuck lock becomes a 409,
  not a hung request), a non-root multi-stage image with a health check.

## Testing

```bash
pnpm test        # unit tests: validation grammar, errors, money, pagination (no Docker)
pnpm test:int    # integration: real PostgreSQL via Testcontainers (concurrency, atomicity, locks, constraints, triggers)
pnpm test:e2e    # the full HTTP stack against real PostgreSQL
pnpm test:all    # everything; pnpm test:cov for coverage
```

Integration and e2e tests start one disposable Postgres container per run (Docker required). No Docker?
Set `TEST_DATABASE_URL` to any Postgres and it is migrated and used instead. Details, including a log of the
bugs found while building, in [docs/TESTING.md](docs/TESTING.md).

## Project layout

```
src/
  accounts/ transactions/ transfers/   feature modules: controller · service · Zod schemas
  ledger/                              LedgerService (the only money path) and response mappers
  common/                              error catalog + filter, Zod validation pipe, money, pagination, request id
  database/                            Drizzle schema and module
  health/ cli/                         readiness; migrate, reconcile and OpenAPI export commands
drizzle/                               SQL migrations (generated schema + hand-written integrity triggers)
test/                                  integration/ and e2e/ suites, shared helpers, Testcontainers setup
docs/                                  API reference, OpenAPI, testing, Supabase guide, ADRs
scripts/                               demo.mjs (worked examples), reconcile.sql
```

## Configuration

| Variable                  | Default | Meaning                                                                               |
| ------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | —       | Postgres connection string (required)                                                 |
| `DIRECT_URL`              | —       | Used for migrations if set (Supabase session pooler / direct host)                    |
| `PORT`                    | `3000`  |                                                                                       |
| `DB_POOL_MAX`             | `10`    | Connection pool size                                                                  |
| `DB_PREPARE`              | `auto`  | `auto` turns prepared statements off for PgBouncer/Supavisor transaction mode (:6543) |
| `DB_LOCK_TIMEOUT_MS`      | `5000`  | Max wait for an account row lock before answering 409                                 |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Statement and idle-in-transaction bound                                               |
| `LOG_LEVEL`               | `info`  | `fatal` … `trace`, `silent`                                                           |
| `BODY_LIMIT`              | `100kb` | Request body cap (413 above it)                                                       |

## Scripts

`pnpm build` · `start:dev` · `lint` · `format` · `typecheck` · `test` · `test:int` · `test:e2e` · `test:all` ·
`db:up` · `db:migrate` · `db:generate` · `db:check` · `db:reconcile` · `openapi:export` · `demo`

## Limitations and scope

- No authentication or authorisation (not requested). Single implicit currency. Accounts cannot be renamed, closed or deleted.
- Offset pagination can shift if new transactions arrive between page requests (the brief asks for page/limit).
- No rate limiting or CORS configuration.
- **Beyond the nominal 3–4 hour scope:** the Testcontainers suites, CI, container image, ADRs and Supabase
  guide go well past what the brief asks. The core API (accounts, transactions, history, transfers) stands on
  its own; everything else exists to prove it correct and make it easy to review.
- The brief has no section 6; nothing is missing.

## License

MIT
