import { expect } from 'vitest';
import { loadReconcileQueries } from '../../src/cli/reconcile-queries.js';
import type { Db } from '../../src/database/database.constants.js';

/**
 * Runs the shared reconciliation SQL (scripts/reconcile.sql) and fails with the offending rows if
 * any invariant is violated: balance == sum(ledger), balance_after chain, complete transfer legs.
 * The checks are global, so they also catch damage done by any earlier test in the run.
 */
export async function assertLedgerConsistent(db: Db): Promise<void> {
  for (const query of loadReconcileQueries()) {
    const rows = await db.$client.unsafe(query.sql);
    expect(rows, `reconciliation "${query.name}" found violations`).toHaveLength(0);
  }
}
