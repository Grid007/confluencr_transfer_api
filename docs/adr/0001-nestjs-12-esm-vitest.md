# 1. NestJS 12 (ESM) with Vitest

**Status:** accepted

## Context

The role's stack is Node-centric, and Confluencr's own take-home guidance has been NestJS (TypeScript). NestJS 12
is ESM-only, runs on Express 5, validates Standard Schema libraries (Zod) natively, and makes Vitest the default
test runner.

## Decision

NestJS 12.2 on Node 24 LTS, TypeScript 6, `module: nodenext`, tests on Vitest 5. The production build uses the Nest
CLI's default `tsc` builder, so every build is type-checked. SWC is used only inside Vitest (`unplugin-swc`),
because esbuild cannot emit decorator metadata and Nest dependency injection needs it.

## Consequences

- Relative imports carry `.js` extensions and `import.meta.dirname` replaces `__dirname`.
- `tsx` is used only for scripts without decorators (migrations, reconcile); it never runs the Nest app.
- `tsc --noEmit` runs in CI because SWC does not type-check.

## Rejected

- **CommonJS + Jest:** works on Node 24 only through `require(esm)` and a newer Jest, and fights Nest 12's direction.
- **Express/Fastify without Nest:** less structure for reviewers to navigate and no built-in DI for testing.
