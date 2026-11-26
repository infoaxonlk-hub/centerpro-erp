import { createHash } from 'node:crypto';

// Migration manifests use SHA-256 over UTF-8 text with LF line endings.
export const canonical = value => value.replace(/\r\n/g, '\n');

export const hashExact = value =>
  createHash('sha256').update(value).digest('hex');

export const hash = value => hashExact(canonical(value));

// Compatibility with migrations previously recorded using CRLF line endings.
export const hashCrlf = value =>
  hashExact(canonical(value).replace(/\n/g, '\r\n'));

export const matchesAppliedMigrationChecksum = (stored, value) =>
  stored === hash(value) || stored === hashExact(value) || stored === hashCrlf(value);
