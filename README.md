# CenterPro

Production-oriented Spice Collection Center ERP by InfoAxon Software Solutions, built with Next.js and Supabase.

## Current foundation

- Supabase email/password authentication and protected sessions
- Organization, center and optional multi-location data model
- User roles and per-center access mapping
- Products, configurable qualities and center price overrides
- Suppliers, purchase orders and purchase lines
- Atomic `confirm_purchase` database function
- Location validation, stock-in, cash deduction, payment, notification and audit logging
- Row Level Security policies
- Responsive production application shell

## Local setup

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env.local` and enter the public Supabase values.
3. Run `supabase/migrations/001_initial_schema.sql` in the target Supabase SQL Editor.
4. Create the first Auth user in Supabase Dashboard.
5. Use `supabase/seed/001_bootstrap.sql` after replacing the user id and business details.
6. Add `SUPABASE_SERVICE_ROLE_KEY` only to the server environment for admin user management.
7. Start with `npm run dev`.

Never expose the service-role key in browser code or commit `.env.local`.
