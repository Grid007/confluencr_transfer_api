# 5. Zod through Nest 12's Standard Schema support

**Status:** accepted

## Context

Validation, TypeScript types and OpenAPI should come from one source. Nest 12 validates any Standard Schema library
natively (`@Body({ schema })`) and `@nestjs/swagger` 12 converts Zod 4.2+ schemas to OpenAPI.

## Decision

Zod 4 schemas are the single definition of every request. A small `ZodValidationPipe` extends Nest's
`StandardSchemaValidationPipe` and parses with `safeParse(value, { reportInput: true })`, so each issue carries the
offending input. That lets `issue-mapper.ts` separate a missing field (`REQUIRED`) from a wrongly typed one
(`INVALID_TYPE`), because the Standard Schema path itself never reports the input. Bodies and queries are
`z.strictObject`, so unknown or server-owned fields are rejected.

## Consequences

- Swagger request schemas are generated from the validators, so docs cannot disagree with behaviour.
- Response schemas for documentation are converted with `z.toJSONSchema(..., { target: 'openapi-3.0' })`.

## Rejected

- **`nestjs-zod`:** its peer ranges stop at Nest 11 / swagger 11; the native path replaces it completely.
- **`class-validator` / `class-transformer`:** a second source of truth alongside the TypeScript types.
