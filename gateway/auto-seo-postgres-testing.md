# Auto SEO PostgreSQL B1 local test

The PostgreSQL repository is test-only. Gateway runtime still uses SQLite.

Use the local PostgreSQL instance at `127.0.0.1:5432/ffp_tool` with user `ffp_tool`. The repository checks the URL and database identity before schema or data operations. Integration tests create only the `auto_seo_b1_test` schema and remove their own `b1-test-*` workflow records. They do not create `seo_review_items`.

Set the test URL in the current PowerShell session using the password from the uncommitted local `.env` file, without printing it:

```powershell
$passwordLine = Get-Content -LiteralPath .env | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
$databasePassword = $passwordLine.Substring('POSTGRES_PASSWORD='.Length).Trim().Trim('"').Trim("'")
$env:AUTO_SEO_TEST_DATABASE_URL = 'postgresql://ffp_tool:' + [uri]::EscapeDataString($databasePassword) + '@127.0.0.1:5432/ffp_tool'
node_modules\.bin\tsx.cmd --test gateway\__tests__\auto-seo-postgres-repository.test.ts
Remove-Item Env:AUTO_SEO_TEST_DATABASE_URL
```

When `AUTO_SEO_TEST_DATABASE_URL` is absent, the integration cases skip during the general gateway test suite. The production migration runner and production connection convention remain for infrastructure to decide in a later phase.
