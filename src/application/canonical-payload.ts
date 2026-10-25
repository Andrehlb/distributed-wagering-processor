import { createHash } from 'node:crypto';
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`)
    .join(',')}}`;
}
export function payloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex');
}
