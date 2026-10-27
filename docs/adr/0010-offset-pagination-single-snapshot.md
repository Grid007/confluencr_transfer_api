# 10. Offset pagination with a single-snapshot count

**Status:** accepted

## Context

The brief specifies `page` and `limit` and wants current page, page size, total records and total pages back.

## Decision

Offset pagination with exactly those inputs and the brief's names in the response meta (`current_page`, `page_size`,
`total_records`, `total_pages`), plus `has_next` and `has_previous`. Rows and total come from one statement using
`count(*) OVER()`, so they describe the same snapshot. Only when a page past the end returns no rows is a second
`count(*)` issued. Ordering is `created_at DESC, seq DESC`, backed by an index whose column order and direction match
the query. Invalid values are rejected with `INVALID_PAGINATION`, never clamped.

## Consequences

- If transactions are inserted between two page requests, items can shift across pages. Documented as a limitation.
- Deep offsets are `O(offset)`. Acceptable for this scope; keyset pagination would be the production answer.

## Rejected

- **Cursor-only pagination:** better at scale, but not what the brief asks for.
- **Separate `count(*)` and page queries:** can disagree under concurrent inserts.
- **Silently clamping `limit`:** hides client bugs.
