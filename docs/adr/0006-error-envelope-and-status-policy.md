# 6. One error envelope and an explicit status policy

**Status:** accepted

## Context

The brief asks for "consistent and understandable" errors. Frameworks produce several shapes (Nest defaults,
body-parser errors, router 404s) unless they are unified.

## Decision

Every non-2xx response is `{ "error": { status, code, message, details?, context?, request_id, timestamp, path } }`,
produced by a single `@Catch()` filter. `code` is a stable, machine-readable value from one catalog that also feeds
the OpenAPI examples and the docs test. Status policy: `400` malformed or invalid, `404` not found, `405` verb not
allowed, `409` conflicts with existing state, `422` valid request rejected by a business rule, `5xx` never for client
mistakes. Duplicate `reference_id` is `409` with the existing transaction (a user decision). Insufficient balance is
`422` so `409` keeps one meaning. Malformed ids are `400`; unknown ids are `404`.

## Consequences

- A body-parser failure, an unknown route, a validation error and a database error look the same to a client.
- Internal error details never leave the process: a 500 carries a generic message and the request id for log lookup.

## Rejected

- **Nest's default error body:** no machine-readable code, shape varies by source.
- **RFC 9457 problem+json:** a fine standard, but the spec's vocabulary (type URIs) adds little for this API.
- **`200` replay for duplicates:** reads as if the duplicate was not detected; the brief asks for a response
  "indicating that the transaction already exists".
