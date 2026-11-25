import { createHash } from 'node:crypto';

// Migration manifests use SHA-256 over UTF-8 text with LF line endings.
// Keep this canonicalization shared by development and release runners.
export const canonical = value => value.replace(/\r\n/g, '\n');
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
