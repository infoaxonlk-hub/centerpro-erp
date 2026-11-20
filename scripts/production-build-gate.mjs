import { run } from './release-migrations.mjs';

// Only return fixed labels and error codes. Never print connection strings or raw driver errors.
export function safeReason(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  if (message.includes('release connection configuration required')) return 'DATABASE_URL_MISSING_OR_INVALID';
  if (message.includes('expected project reference required')) return 'PROJECT_REF_MISSING';
  if (message.includes('expected target and least-privilege database role required')) return 'TARGET_OR_ROLE_MISMATCH';
  if (message.includes('connection url parameters forbidden')) return 'CONNECTION_URL_PARAMETERS';
  if (message.includes('no release baseline')) return 'RELEASE_LEDGER_MISSING';
  if (message.includes('permission denied')) return 'DATABASE_ROLE_PERMISSION_DENIED';
  if (message.includes('password authentication failed')) return 'DATABASE_AUTHENTICATION_FAILED';
  if (message.includes('certificate') || message.includes('self-signed')) return 'DATABASE_TLS_CERTIFICATE_FAILURE';
  if (message.includes('database is behind')) return 'PENDING_MIGRATIONS';
  if (message.includes('ledger missing, changed or reordered')) return 'RELEASE_LEDGER_MISMATCH';
  if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ECONNRESET'].includes(code)) return `CONNECTION_${code}`;
  if (code === '28P01') return 'DATABASE_AUTHENTICATION_FAILED';
  if (code === '42501') return 'DATABASE_ROLE_PERMISSION_DENIED';
  return 'UNCLASSIFIED_RELEASE_GATE_FAILURE';
}

// Vercel must retain system environment variables and use the repository build command.
if (process.env.VERCEL_ENV === 'production') {
  try { await run(['verify']); }
  catch (error) { console.error(`Production database release verification failed [${safeReason(error)}]. Publication blocked.`); process.exitCode = 1; }
} else if (process.env.VERCEL === '1' && !['preview', 'development'].includes(process.env.VERCEL_ENV)) {
  console.error('Unknown Vercel environment. Publication blocked.'); process.exitCode = 1;
}
