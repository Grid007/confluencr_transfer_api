import type { Db } from '../../src/database/database.constants.js';

/**
 * Fault injection without touching production code: a BEFORE INSERT trigger that raises for credit
 * rows whose description is '__FAIL__'. A plain credit fails after the balance UPDATE ran; a
 * transfer with that description fails on its credit leg after the debit leg was written. Either
 * way, a correct implementation must roll everything back.
 */
export async function installFailureTrigger(db: Db): Promise<void> {
  const c = db.$client;
  await c.unsafe(`
    create or replace function public.test_fail_insert() returns trigger language plpgsql as $$
    begin
      raise exception 'injected failure' using errcode = 'P0001';
    end; $$`);
  await c.unsafe('drop trigger if exists test_fail_credit on public.transactions');
  await c.unsafe(`
    create trigger test_fail_credit before insert on public.transactions
    for each row when (new.description = '__FAIL__' and new.type = 'credit')
    execute function public.test_fail_insert()`);
}

export async function removeFailureTrigger(db: Db): Promise<void> {
  await db.$client.unsafe('drop trigger if exists test_fail_credit on public.transactions');
  await db.$client.unsafe('drop function if exists public.test_fail_insert()');
}
