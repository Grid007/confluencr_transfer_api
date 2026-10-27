# Running on Supabase

The service is plain PostgreSQL. Nothing is Supabase-specific except connection settings.

## 1. Connection string

In the Supabase dashboard open **Connect** and copy the **Session pooler** string (IPv4, port 5432):

```
postgresql://postgres.<project-ref>:<url-encoded-password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Put it in `DATABASE_URL`. Notes:

- The direct host `db.<ref>.supabase.co` is **IPv6-only** unless you buy the IPv4 add-on. It fails from IPv4-only
  networks, including GitHub Actions and many home connections. The session pooler always works over IPv4.
- URL-encode special characters in the password.
- `sslmode=require` is mapped to TLS by the driver.
- A long-running server like this one should use the **session** pooler (or the direct host). Prepared statements and
  `SET LOCAL` both work there.

## 2. Migrate and run

```bash
pnpm db:migrate     # owner-level DDL only: no superuser, no extensions
pnpm start:dev
node scripts/demo.mjs
```

Optionally set `DIRECT_URL` (session pooler or direct host) to use a different connection for migrations.

## 3. Transaction pooler (port 6543)

Supports the app, with one switch: prepared statements must be off in transaction mode. The default
`DB_PREPARE=auto` detects port `6543` or `?pgbouncer=true` and turns them off. Nothing else needs to change:
every statement that matters runs inside one explicit transaction, lock and statement timeouts are set with
`set_config(..., true)` (transaction-local), and no session state, session advisory locks or `LISTEN` are used.
Run migrations over the session pooler or direct host, not the transaction pooler.

## 4. Row level security

All three tables have row level security **enabled with no policies**. For Supabase this is the right posture: the
public Data API roles (`anon`, `authenticated`) see nothing, while the table owner, which is the role this service
connects as, bypasses RLS. If you connect as a different, non-owner role, every read would silently return zero rows.
`GET /health` detects exactly this and answers `503` with `ledger_access: blocked by row level security`, rather than
letting it look like data loss. Fix it by connecting as the migrating (owner) role.

## 5. Checking it worked

- `curl $API/health` → `200`, `ledger_access: ok`
- `node scripts/demo.mjs --base $API` → all checks pass
- Supabase **Table Editor** shows the three tables with RLS enabled
- `DATABASE_URL=… pnpm db:reconcile` → all queries report zero violations
