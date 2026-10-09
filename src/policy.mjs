import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AuditError } from './git.mjs';

export const policyPath = new URL('../policy/attribution-v1.json', import.meta.url);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalize = text => text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const trailerKey = text => normalize(text).replace(/[\s_-]/g, '');
export function unique(values, label, normalizer = normalize) {
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !v.trim())) throw new AuditError('policy.invalid', `${label} must be nonempty strings`);
  const result = values.map(normalizer);
  if (new Set(result).size !== result.length) throw new AuditError('policy.duplicate-alias', `Duplicate normalized alias in ${label}`);
  return new Set(result);
}
export function loadPolicy(config = {}) {
  const bytes = readFileSync(policyPath), canonical = JSON.parse(bytes);
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.schemaVersion !== undefined && config.schemaVersion !== 1)) throw new AuditError('policy.schema', 'Configuration must use schemaVersion 1');
  if (config.mode !== undefined && !['deny-known', 'approved'].includes(config.mode)) throw new AuditError('policy.invalid-mode', 'Identity mode must be deny-known or approved');
  const knownKeys = ['schemaVersion', 'mode', 'approvedIdentities', 'extraForbiddenNames', 'extraForbiddenEmails', 'extraForbiddenDomains'];
  if (Object.keys(config).some(k => !knownKeys.includes(k))) throw new AuditError('policy.override', 'Configuration may only tighten the canonical policy');
  const names = unique(canonical.forbiddenNames, 'forbiddenNames');
  const emails = unique(canonical.forbiddenEmails, 'forbiddenEmails');
  const domains = unique(canonical.forbiddenDomains, 'forbiddenDomains');
  for (const [field, set] of [['extraForbiddenNames', names], ['extraForbiddenEmails', emails], ['extraForbiddenDomains', domains]]) {
    for (const value of unique(config[field] ?? [], field)) {
      if (set.has(value)) throw new AuditError('policy.duplicate-alias', `Duplicate canonical alias in ${field}`);
      set.add(value);
    }
  }
  const approved = new Map();
  for (const entry of config.approvedIdentities ?? []) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.email !== 'string' || !['human', 'automation'].includes(entry.kind) || typeof entry.review !== 'string' || !entry.review.trim()) throw new AuditError('policy.approval', 'Each identity needs name, email, kind and auditable review record');
    const key = `${normalize(entry.name)}\0${normalize(entry.email)}`;
    if (approved.has(key)) throw new AuditError('policy.duplicate-identity', 'Duplicate approved identity');
    approved.set(key, entry);
  }
  return { id: canonical.id, version: canonical.version, sha256: digest(bytes), mode: config.mode ?? 'deny-known', names, emails, domains, approved, keys: unique(canonical.identityTrailerKeys, 'identityTrailerKeys', trailerKey) };
}
export function parseIdentity(value, header = false) {
  const match = (header ? /^(.*?)\s*<([^<>\r\n]*)> (-?\d+) ([+-]\d{4})$/ : /^(.*?)\s*<([^<>\r\n]*)>\s*$/).exec(value);
  if (!match || !match[1].trim() || /[<>\r\n]/.test(match[1])) throw new AuditError('metadata.identity', 'Malformed identity-bearing metadata; use Name <address>');
  if (header && (Number(match[4].slice(1, 3)) > 23 || Number(match[4].slice(3)) > 59)) throw new AuditError('metadata.timezone', 'Invalid commit timezone');
  return { name: normalize(match[1]), email: normalize(match[2]) };
}
export function identityRule(identity, policy) {
  const at = identity.email.lastIndexOf('@');
  const domain = at < 0 ? null : identity.email.slice(at + 1);
  if (policy.names.has(identity.name) || policy.emails.has(identity.email) || domain !== null && [...policy.domains].some(d => domain === d || domain.endsWith(`.${d}`))) return 'attribution.ai-identity';
  if (policy.mode === 'approved' && !policy.approved.has(`${identity.name}\0${identity.email}`)) return 'attribution.unapproved-identity';
  return null;
}
export function trailers(message, policy) {
  // Terminal trailer paragraph. Unrelated lines cannot neutralize a structured trailer.
  let fence = null;
  const lines = message.trimEnd().split('\n').map(line => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delimiter) { if (!fence) fence = delimiter[1][0]; else if (delimiter[1][0] === fence) fence = null; return '> quoted example'; }
    return fence ? '> quoted example' : line;
  });
  let start = lines.length;
  while (start > 0 && lines[start - 1].trim()) start--;
  const block = lines.slice(start);
  const result = [];
  let current = null;
  for (const line of block) {
    const m = /^([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*)$/.exec(line);
    if (m) { current = { key: trailerKey(m[1]), value: m[2] }; result.push(current); }
    else if (/^[ \t]+\S/.test(line) && current) current.value += ` ${line.trim()}`;
    else current = null;
  }
  return result.filter(t => policy.keys.has(t.key));
}
