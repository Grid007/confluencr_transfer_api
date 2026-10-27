import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReconcileQuery {
  name: string;
  sql: string;
}

/** Splits scripts/reconcile.sql on its `-- name:` markers. */
export function loadReconcileQueries(
  file = resolve(import.meta.dirname, '../../scripts/reconcile.sql'),
): ReconcileQuery[] {
  const text = readFileSync(file, 'utf8');
  return text
    .split(/^-- name: /m)
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return { name: name!.trim(), sql: rest.join('\n').trim().replace(/;$/, '') };
    });
}
