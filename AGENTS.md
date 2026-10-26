# Development workflow

- Make ordinary application changes on `development`, not directly on `main`.
- Push `development` to `origin/development` for Vercel Preview testing.
- Run checks relevant to each change and test the Preview before merging into `main`.
- `main` is the production branch; pushes there can trigger a production deployment.
- Never commit environment files, Supabase service-role keys, or other credentials.