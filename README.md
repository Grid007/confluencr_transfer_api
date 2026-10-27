# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credits and debits, read balances and
paginated history, and move money between accounts atomically. Built for the Walnut Folks Group /
Confluencr Full Stack Developer assessment.

**Stack:** NestJS 12 (TypeScript 6, ESM) · PostgreSQL 17 · Drizzle ORM · Zod 4 · Vitest.

## Run it

The API needs **Node 22.22+ (or 24 LTS), pnpm 12 and a PostgreSQL 13+ database**. Docker is one convenient
way to get the database; it is not required.

```bash
npm install -g pnpm@12.15.0          # pnpm 9/10 refuse this repo's packageManager field, by design
pnpm install
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
```

Then pick **one** way to provide the database:

**A. With Docker**

```bash
docker compose up -d db              # Postgres 17 on :5432, matches .env.example
```

**B. Without Docker, using any local PostgreSQL**

```bash
createdb ledger                      # or: psql -c "create database ledger"
# edit DATABASE_URL in .env, for example: postgres://USER:PASSWORD@localhost:5432/ledger
```

Then, for either option:

```bash
pnpm db:migrate                      # creates the tables, constraints and triggers
pnpm start:dev                       # http://localhost:3000/docs  (Swagger UI)
node scripts/demo.mjs                # in another terminal: replays the brief's worked examples
```

Everything in the app and the test suites works with a plain PostgreSQL; nothing depends on Docker.

**Optional, everything in containers** (database, migrations and API; needs only Docker):

```bash
docker compose --profile full up --build -d --wait
curl localhost:3000/health
docker compose --profile full down -v
```

## The 15-minute reviewer path

1. Start the database and API as above, then run `node scripts/demo.mjs`. It prints the brief's examples
   (0 +100 +50 −30 −20 = 100, debit 150 on 100 rejected, duplicate `reference_id` → 409, transfer
   30 → 70/80) and asserts each one.
2. Open `/docs` and try the endpoints. Every error response has a named example.
3. Run the tests (see [Testing](#testing)). Read [test/integration/transfers.int-spec.ts](test/integration/transfers.int-spec.ts)
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
- **Operations.** Structured JSON logs with a request id, graceful shutdown, a readiness endpoint, lock and statement timeouts (a stuck lock becomes a 409,
  not a hung request), a non-root multi-stage image with a health check.

## Testing

```bash
pnpm test        # unit tests: validation grammar, errors, money, pagination (no Docker)
pnpm test:int    # integration: real PostgreSQL via Testcontainers (concurrency, atomicity, locks, constraints, triggers)
pnpm test:e2e    # the full HTTP stack against real PostgreSQL
pnpm test:all    # everything; pnpm test:cov for coverage
```

Integration and e2e tests need a real PostgreSQL. By default they start one disposable container per run
(Docker). **Without Docker**, point them at any Postgres you can write to and it is migrated and used instead:
`TEST_DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/ledger_test pnpm test:all`. Details, including a log of the
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
docs/                                  API reference, OpenAPI, testing guide, ADRs
scripts/                               demo.mjs (worked examples), reconcile.sql
```

## Configuration

| Variable                  | Default | Meaning                                               |
| ------------------------- | ------- | ----------------------------------------------------- |
| `DATABASE_URL`            | —       | Postgres connection string (required)                 |
| `PORT`                    | `3000`  |                                                       |
| `DB_POOL_MAX`             | `10`    | Connection pool size                                  |
| `DB_LOCK_TIMEOUT_MS`      | `5000`  | Max wait for an account row lock before answering 409 |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Statement and idle-in-transaction bound               |
| `LOG_LEVEL`               | `info`  | `fatal` … `trace`, `silent`                           |
| `BODY_LIMIT`              | `100kb` | Request body cap (413 above it)                       |

## Scripts

`pnpm build` · `start:dev` · `lint` · `format` · `typecheck` · `test` · `test:int` · `test:e2e` · `test:all` ·
`db:up` · `db:migrate` · `db:generate` · `db:check` · `db:reconcile` · `openapi:export` · `demo`

## Limitations and scope

- No authentication or authorisation (not requested). Single implicit currency. Accounts cannot be renamed, closed or deleted.
- Offset pagination can shift if new transactions arrive between page requests (the brief asks for page/limit).
- No rate limiting or CORS configuration.
- **Beyond the nominal 3–4 hour scope:** the Testcontainers suites, CI, container image, and ADRs
  go well past what the brief asks. The core API (accounts, transactions, history, transfers) stands on
  its own; everything else exists to prove it correct and make it easy to review.
- The brief has no section 6; nothing is missing.

## License

MIT
