# Auto SEO B3 runtime

The gateway reads and writes Auto SEO backups through `AutoSeoPostgresRepository` using the server-only `AUTO_SEO_DATABASE_URL`. Use a Node `pg` URL (`postgresql://...`). Host-side local tests target `127.0.0.1:5432/ffp_tool`; a future container deployment can target `database:5432/ffp_tool`. Do not use the Python `postgresql+psycopg://` URL.

The backup batch commits in PostgreSQL before downstream SEO starts. Custom GPT handoff recovery reads pending backup rows from the same PostgreSQL table and acknowledges them there after enqueue. The Custom GPT queue stays in `custom-gpt-seo.sqlite3`. `seo_review_items` stays in the existing Auto SEO SQLite file until the separate SEO Review migration. The old SQLite backup table remains only as migration source and legacy test reference; runtime has no PostgreSQL-to-SQLite fallback.

The gateway expects the PostgreSQL backup schema to exist before runtime traffic. Infrastructure owns production schema migration and startup ordering. B3 does not deploy to production or migrate SEO Review.

To run PostgreSQL integration tests locally, set `AUTO_SEO_TEST_DATABASE_URL` to the local `127.0.0.1:5432/ffp_tool` database using a password from a private local environment file. The tests verify the local database identity before writing and clean only their isolated test workflow rows. Set `AUTO_SEO_DATABASE_URL` separately for local runtime requests.
