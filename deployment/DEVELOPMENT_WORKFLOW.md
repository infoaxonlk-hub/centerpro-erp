# Development, Preview and production

Use `development` for application changes. Keep `main` as the Vercel production branch.

## Vercel setup

In the existing Vercel project's Git settings, verify its linked repository is infoaxonlk-hub/centerpro-erp and its production branch is main. Keep automatic Preview deployments enabled for development.

In Settings > Environment Variables, enable these values for Preview (or scope them to development):

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SERVICE_ROLE_KEY (server only)

Pushes to development should produce Preview deployments. Open the development deployment in Vercel's Deployments list and use its Preview URL. Changes to environment variables require a new deployment.

A Preview deployment isolates application code, not the database. If Preview uses production Supabase credentials, test with a dedicated demo business; test writes and SQL migrations still affect that shared database. A separate test Supabase project can be configured through Preview-only environment variables when needed.

## Make and test a change

    git switch development
    git pull --ff-only origin development

Make changes, run relevant checks, then stage the specific files changed:

    git add <changed-files>
    git commit -m "Describe the change"
    git push origin development

Wait for the development Preview deployment to be Ready and test the changed workflows there. Review any failing checks before release.

## Release tested changes

Open a pull request with base main and compare development:
https://github.com/infoaxonlk-hub/centerpro-erp/compare/main...development

Review and merge the tested changes. Merging into main triggers the production deployment when Vercel Git integration is enabled. Check production deployment status and verify the released behavior.

After the merge, sync development with main:

    git switch development
    git fetch origin
    git merge origin/main
    git push origin development

References:
- https://vercel.com/docs/git
- https://vercel.com/docs/environment-variables