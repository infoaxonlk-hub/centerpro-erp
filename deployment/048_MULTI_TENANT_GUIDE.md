# Multiple businesses in one database

Apply all existing database migrations first, then run supabase/migrations/044_multi_tenant_businesses.sql in the Supabase SQL editor before deploying this application version. The migration preserves existing business data. Back up the database and validate in staging first.

Configure SUPABASE_SERVICE_ROLE_KEY on the server only. Sign in with the existing active super_admin account and open Businesses in the sidebar. Supply business name, admin name, a unique email and a password. Give these credentials to the business administrator through your usual secure channel. Every business uses the same /login URL and Supabase database; the profile determines its business automatically.

Business administrators receive all existing business permissions. They cannot provision businesses or create platform super admins. Each new business starts empty; its administrator creates centers and products.

Existing operators, including super admins using operational screens, remain scoped to their assigned organization. The platform Businesses page uses a server-only service client after checking the current authenticated super_admin. There is no implicit cross-business operational access.

Validate using two separate businesses: create centers/products/suppliers and transactions in each; verify lists, reports, direct record URLs, REST requests, RPC requests, photos and cross-business foreign-key writes cannot expose or alter the other business. Verify a business admin receives 403 from both business-management API methods.

The migration adds restrictive tenant policies alongside existing permissions, guards RPC writes and checks referenced records belong to the same business. Future public tables require tenant ownership through organization_id or a public foreign-key chain. Ownership resolution fails closed when ownership cannot be found.

Provisioning spans Auth and database calls. Failures attempt compensation and log cleanup errors on the server; check server logs and remove any orphan accounts/workspaces after a cleanup failure. No passwords are logged or returned.
