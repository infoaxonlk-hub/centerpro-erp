# CenterPro — new development database setup

Use this on a **new and empty Supabase development project only**. The setup script is intentionally blocked from modifying the project's protected `supabase/config.toml` project reference, and it verifies that the Postgres connection string and Supabase API URL both match the development project reference.

## Initial setup (team member)

1. Clone/pull the latest `development` branch.
2. Run `npm install`.
3. Copy values from `.env.development.example` into your own **untracked** `.env.local`. Obtain the **session pooler** PostgreSQL URL, publishable key, and **server-side service-role key** from YOUR new Supabase development project. Never post or commit credentials.
4. Set `CENTERPRO_DEV_PROJECT_REF` to that Supabase project's 20-character reference and `CENTERPRO_DB_SETUP_MODE=development`. Use a unique admin password (12+ characters) in `DEV_BOOTSTRAP_ADMIN_PASSWORD`; do not reuse `Admin@123`.
5. Run `npm run db:plan:dev` (offline syntax/ordering validation).
6. Run `npm run db:setup:dev`. It runs all migration files found in `supabase/migrations` in filename order (including future additions), applies API grants without disabling RLS, and creates **admin@gmail.com** as the first Super Admin if and only if no Super Admin exists. It also creates a demo organization and default center/location when needed.
7. Run `npm run dev`. With `CENTERPRO_AUTO_SETUP_DEV_DB=true`, `predev` checks and applies **only newly added** migrations automatically; existing admins and passwords are untouched.

## Safety model

- The setup requires an explicit development mode and matching project reference in three places; it refuses the protected project in `supabase/config.toml`.
- Existing databases created manually or through Supabase's native migration history **must not be reinitialized** by this script. It aborts instead of trying to recreate tables or change existing users.
- SQL files and their SHA-256 checksums are recorded in private `centerpro_setup.applied_migrations`. An applied file cannot be silently changed; add a NEW SQL file instead.
- A single Postgres transaction covers each migration and its history entry. The legacy migrations' outer BEGIN/COMMIT are safely unwrapped for that purpose. If migration N fails, later files and seeding do not run.
- Permissions are rechecked after migration. `authenticated` receives privileges only on RLS-enabled tables with matching policies. `service_role` has server-side privileges and its key must never be exposed to browsers.
- Existing Super Admin? Seed is skipped. If `admin@gmail.com` already exists in Auth but there is no Super Admin, the script **refuses automatic elevation**. Verify account ownership and repair it manually; never silently change passwords.
- **Production does not run this script**: neither `npm run build` nor `npm run start` triggers it. Never add it to production build hooks. Production schema changes require separate, reviewed migrations, a backup, and explicit approval.
- This compatibility setup uses a **private migration ledger**, NOT Supabase CLI's `supabase_migrations.schema_migrations`. Do not mix `supabase db push` against a database initialized by this script without a carefully reviewed one-time migration-history reconciliation.
- The old `supabase/seed/001_bootstrap.sql` hardcodes a different Auth user ID and **must not** be run on teammates' new databases.

## Troubleshooting

- **Missing DEV_DATABASE_URL**: copy the connection string from the correct Supabase development project. For a pooler URL the DB username must be `postgres.<project-ref>`.
- **Invalid credentials**: obtain DB password from the database's settings; passwords are not the same as the publishable/service-role keys.
- **"Existing database has no bootstrap history"**: stop. Your database was migrated manually. Don't rerun migrations: either use a new empty development project or first reconcile its existing migration history.
- **Seed fails**: migrations are already applied and safely recorded. Fix the seed prerequisites and rerun the setup; it skips completed migrations.
- **Vercel Preview**: `npm run dev` auto-setup is for developers' local development machines. Deploy Preview code **after** database setup. Do not use production Supabase credentials for Preview.
