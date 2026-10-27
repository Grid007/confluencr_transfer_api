# 3. Money is `NUMERIC(19,2)`, computed in SQL, serialised as strings

**Status:** accepted

## Context

Floats cannot represent most decimal amounts exactly (`0.1 + 0.2`). The wire format implied by the brief is decimal
(`50`, `150`), so a cents-based representation needs a conversion in both directions.

## Decision

`NUMERIC(19,2)` for `amount`, `balance` and `balance_after`. All arithmetic is SQL (`balance = balance + $1::numeric`).
postgres.js returns numerics as strings, so a float cannot enter without an explicit cast, and `"150.00"` comes out
of Postgres ready to serialise. JSON input may be a number or a numeric string with a strict grammar; more than two
decimals is rejected, a single amount is capped at 1e12. The only JavaScript money code (`common/money`) works on
BigInt minor units and is used for the insufficient-balance comparison and the `shortfall` field.

## Consequences

- No rounding anywhere. The cap keeps every accepted JSON number exactly representable.
- Credit overflow of the column raises `22003`, mapped to `422 BALANCE_LIMIT_EXCEEDED` instead of a 500.

## Rejected

- **`BIGINT` minor units:** exact, but adds cents↔units conversion at both edges, BigInt-in-JSON pitfalls, and
  unreadable values when inspecting the database.
- **Floats / `Number`:** incorrect for money.
- **Silently rounding extra decimals:** would move money the caller did not ask to move.
