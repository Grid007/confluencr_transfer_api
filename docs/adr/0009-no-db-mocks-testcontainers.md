# 9. No database mocks: Testcontainers and fresh accounts

**Status:** accepted

## Context

The guarantees that matter (locks, constraints, triggers, `numeric` behaviour, SQLSTATE mapping) exist only in a real
PostgreSQL. A mocked or SQLite-backed suite would test a different system.

## Decision

Unit tests cover pure logic only. Everything involving SQL runs against a real `postgres:17.11-alpine`, started once
per run by Testcontainers (`globalSetup`, tmpfs data directory). Tests isolate themselves by creating fresh accounts
and never truncate, because the immutability triggers forbid it. `TEST_DATABASE_URL` allows an existing database when
Docker is unavailable. One Vitest `db` project covers integration and e2e so only one container starts.

## Consequences

- Docker is required for `test:int` and `test:e2e`; CI runs on a runner that ships Docker.
- Concurrency tests size the connection pool above the number of parallel requests so contention happens on the row
  lock, not in the pool.
- Fault injection uses a temporary `BEFORE INSERT` trigger created by the test, with no production test hooks.

## Rejected

- **SQLite / in-memory fakes:** ignore `FOR UPDATE`, use a different type system; known to hide exactly these bugs.
- **Mocking Drizzle:** proves the mock, not the ledger.
- **A container per test file:** doubles start-up time for no isolation benefit.
