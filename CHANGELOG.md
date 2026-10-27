# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-27

### Added

- Accounts: create (balance always starts at 0), fetch, balance.
- Transactions: credit and debit with per-account `reference_id` idempotency, `balance_after`, insufficient-balance rejection.
- History: newest first, `type` filter, `page`/`limit` pagination with `current_page`, `page_size`, `total_records`, `total_pages`.
- Transfers (bonus): atomic two-leg transfers with deadlock-free ordered locking.
- One error envelope for every failure, stable error codes, request ids, bounded lock waits.
- Database-level integrity: constraints, immutability triggers, zero initial balance, RLS enabled.
- OpenAPI document and Swagger UI generated from the same Zod schemas that validate requests.
- Unit, integration (Testcontainers) and end-to-end suites; reconciliation SQL; demo script.
- Docker image, Compose stack, GitHub Actions CI, Supabase guide, ADRs.
