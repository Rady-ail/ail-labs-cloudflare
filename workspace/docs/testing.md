# Testing

Run from `workspace/`.

- `npm test`: Vitest suite. The three write-enabled Postgres integration files skip their database-writing cases unless the explicit gate below is satisfied.
- `npm run typecheck`: TypeScript check.
- `npm run test:integration`: explicitly opts into the three Postgres integration files; it does **not** bypass the database-name safety check.

## Postgres write-test safety gate

The database-writing cases in `test/email-drafts.test.ts`, `test/email-threads.test.ts`, and `test/email-live.test.ts` run only when all conditions are true:

1. `DATABASE_URL` is set.
2. `TEST_DATABASE_ALLOW_WRITE=1`.
3. The database name parsed from the URL contains `test` (case-insensitive).

Otherwise Vitest uses `describe.skipIf` for the write suite and emits a clear `console.warn` without printing connection details. Read-only/unit cases outside those suites remain runnable.

Use a dedicated disposable test database. Never point these tests at production or the operational `ail_workspace` database. The integration tests insert, update, and delete records. Confirm the target database name before running `npm run test:integration`.

The Worker does not run these test files. Claude's PGlite/mocked behavioral tests are separate and must not be reported as results of these real-Postgres write integration tests.
