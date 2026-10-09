import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export class AuditError extends Error {
  constructor(rule, detail) { super(detail); this.rule = rule; }
}
export const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function oid(value) {
  if (typeof value !== 'string' || !oidPattern.test(value)) throw new AuditError('scope.invalid-oid', 'Expected a complete lowercase Git object ID');
  return value;
}
export function refName(value) {
  if (typeof value !== 'string' || !/^refs\/(heads|tags)\//.test(value) || /[\s~^:?*\[\\\x00-\x1f]/.test(value) || value.includes('..') || value.includes('@{') || value.endsWith('/') || value.endsWith('.') || value.split('/').some(p => p.startsWith('.') || p.endsWith('.lock'))) throw new AuditError('scope.invalid-ref', 'Expected a complete publication branch/tag ref');
  return value;
}
export function git(repo, args, input, binary = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
  const r = spawnSync('git', ['--no-optional-locks', '-C', resolve(repo), '-c', 'core.hooksPath=/dev/null', ...args], { env, input, encoding: binary ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new AuditError('history.git-failure', `Git operation ${args[0]} failed; no inspected hooks or code were executed`);
  return binary ? r.stdout : r.stdout.trimEnd();
}
export function repositorySafety(repo) {
  if (git(repo, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new AuditError('history.shallow', 'Unshallow the repository from its intended source before auditing');
  const common = resolve(repo, git(repo, ['rev-parse', '--git-common-dir']));
  const grafts = resolve(common, 'info/grafts');
  if (existsSync(grafts) && readFileSync(grafts).toString().trim()) throw new AuditError('history.grafts', 'Remove the local graft overlay before auditing');
  if (git(repo, ['for-each-ref', '--format=%(refname)', 'refs/replace']).trim()) throw new AuditError('history.replacements', 'Remove replacement refs before auditing; replacement objects are disabled');
  return common;
}
export function rawObject(repo, id) {
  oid(id);
  const type = git(repo, ['cat-file', '-t', id]);
  const bytes = git(repo, ['cat-file', type, id], undefined, true);
  const hash = createHash(id.length === 40 ? 'sha1' : 'sha256').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== id) throw new AuditError('history.corrupt-object', 'Raw object does not match its content address');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new AuditError('metadata.encoding', 'Object metadata is not valid UTF-8'); }
  if (content.includes('\0')) throw new AuditError('metadata.nul', 'Object metadata contains a NUL byte');
  return { type, content };
}
export function peelCommit(repo, id, seen = new Set()) {
  oid(id);
  if (seen.has(id)) throw new AuditError('metadata.tag-cycle', 'Annotated tag cycle');
  seen.add(id);
  const object = rawObject(repo, id);
  if (object.type === 'commit') return id;
  if (object.type !== 'tag') throw new AuditError('scope.not-commit', 'Publication ref does not resolve to a commit');
  const match = /^object ([a-f0-9]+)\ntype (commit|tag)\ntag [^\n]+\n/.exec(object.content);
  if (!match) throw new AuditError('metadata.tag', 'Malformed annotated tag');
  return peelCommit(repo, oid(match[1]), seen);
}
