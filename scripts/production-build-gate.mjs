import { run } from './release-migrations.mjs';

// Vercel must retain system environment variables and use the repository build command.
if (process.env.VERCEL_ENV === 'production') {
  try { await run(['verify']); }
  catch { console.error('Production database release verification failed. Publication blocked.'); process.exitCode = 1; }
} else if (process.env.VERCEL === '1' && !['preview', 'development'].includes(process.env.VERCEL_ENV)) {
  console.error('Unknown Vercel environment. Publication blocked.'); process.exitCode = 1;
}
