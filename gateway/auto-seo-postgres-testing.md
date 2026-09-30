# Auto SEO PostgreSQL local verification

Production Auto SEO backups and reviews use `AUTO_SEO_DATABASE_URL`. The URL must use Node's `postgresql://` scheme. Docker Compose passes this server-only variable from the untracked `.env` file; it must not be a `VITE_` variable. `AUTO_SEO_DB_PATH` is only a legacy SQLite migration input.

The direct Gateway entry point runs `bootstrapAutoSeoSchema` before listening on port 3001. Bootstrap creates the backup table first, then the review table, checks the required indexes and constraints, and fails closed on error. It never copies SQLite data. Run `gateway/auto-seo-migrate-local.ts` explicitly for a legacy data migration.

For host-side integration tests, set a temporary test URL using the password in the untracked `.env`, without printing it:

```powershell
$passwordLine = Get-Content -LiteralPath .env | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
$databasePassword = $passwordLine.Substring('POSTGRES_PASSWORD='.Length).Trim().Trim('"').Trim("'")
$env:AUTO_SEO_TEST_DATABASE_URL = 'postgresql://ffp_tool:' + [uri]::EscapeDataString($databasePassword) + '@127.0.0.1:5432/ffp_tool'
node_modules\.bin\tsx.cmd --test gateway\__tests__\auto-seo-postgres-repository.test.ts gateway\__tests__\auto-seo-migration.test.ts gateway\__tests__\auto-seo-postgres-runtime.test.ts gateway\__tests__\auto-seo-review-postgres.test.ts gateway\__tests__\auto-seo-startup.test.ts
Remove-Item Env:AUTO_SEO_TEST_DATABASE_URL
```

The B5 startup test uses a fresh, randomly named schema and drops only that schema afterward. The B1–B4 tests use their own test schemas. They do not modify the 14 migrated backups in `public`.

For Docker configuration, validate the parsed values without printing secrets:

```powershell
docker compose config --quiet
$configuration = docker compose config --format json | ConvertFrom-Json
if (-not $configuration.services.server.environment.AUTO_SEO_DATABASE_URL) { throw 'Server missing AUTO_SEO_DATABASE_URL' }
if ($configuration.services.client.environment.AUTO_SEO_DATABASE_URL) { throw 'Auto SEO URL exposed to client' }
if ($configuration.services.client.environment.PSObject.Properties.Name -match '^VITE_.*AUTO_SEO') { throw 'Auto SEO URL exposed as VITE variable' }
'Auto SEO server-only environment verified'
```

The existing `database`, `server`, and `client` services are used for runtime checks; never use `docker compose down -v` against the working local project.
