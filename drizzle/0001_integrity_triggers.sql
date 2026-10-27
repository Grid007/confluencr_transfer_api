-- Ledger immutability, enforced by the database itself (not only by the API).
-- Owner-level DDL only (no superuser, no extensions), so these files run unchanged on Supabase.
CREATE OR REPLACE FUNCTION public.ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger: % on % is not allowed (rows are immutable)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transactions_immutable BEFORE UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER transactions_no_truncate BEFORE TRUNCATE ON public.transactions FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER transfers_immutable BEFORE UPDATE OR DELETE ON public.transfers FOR EACH ROW EXECUTE FUNCTION public.ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER transfers_no_truncate BEFORE TRUNCATE ON public.transfers FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_reject_mutation();
--> statement-breakpoint
-- Accounts: only the balance may change. id, name and created_at are frozen; rows cannot be deleted.
CREATE OR REPLACE FUNCTION public.accounts_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger: accounts cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ledger: only accounts.balance may be updated' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_protect BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.accounts_protect();
--> statement-breakpoint
CREATE TRIGGER accounts_no_truncate BEFORE TRUNCATE ON public.accounts FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_reject_mutation();
