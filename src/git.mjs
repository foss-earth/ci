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
  const prefix = ['--no-optional-locks', '-C', resolve(repo), '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
  // Reading local config executes no subject helper. Reject includes, URL
  // rewrites and command-capable settings BEFORE any object/transport operation.
  for (const scope of ['--local', '--worktree']) {
    const local = spawnSync('git', [...prefix, 'config', scope, '--no-includes', '--null', '--list'], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (local.status === 0) {
      const keys = local.stdout.split('\0').filter(Boolean).map(entry => entry.split('\n')[0].toLowerCase());
    if (keys.some(key => /^(include\.|includeif\.|url\.|credential\.|filter\.|gpg\.)/.test(key) || ['core.sshcommand', 'core.gitproxy', 'core.fsmonitor', 'core.attributesfile'].includes(key) || /^merge\..*\.driver$|^diff\..*\.(command|textconv)$|^remote\..*\.(vcs|proxy|uploadpack|receivepack|mirror)$/.test(key))) throw new AuditError('history.unsafe-config', 'Subject configuration contains includes, URL rewrites or command-capable settings; audit an isolated object replica with reviewed transport settings');
    } else if (!['init', 'clone'].includes(args[0])) throw new AuditError('history.config-read', 'Could not inspect subject local/worktree Git configuration');
  }
  const r = spawnSync('git', [...prefix, ...args], { env, input, encoding: binary ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024 });
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
export function peelCommit(repo, id, seen = new Set(), tags = new Map(), expectedType) {
  oid(id);
  try {
  if (seen.has(id)) throw new AuditError('metadata.tag-cycle', 'Annotated tag cycle');
  seen.add(id);
  const object = rawObject(repo, id);
  if (expectedType && object.type !== expectedType) throw new AuditError('metadata.tag-target-type', 'Annotated tag target type does not match its raw header');
  if (object.type === 'commit') return id;
  if (object.type !== 'tag') throw new AuditError('scope.not-commit', 'Publication ref does not resolve to a commit');
  const separator = object.content.indexOf('\n\n');
  if (separator < 0) throw new AuditError('metadata.tag', 'Annotated tag lacks a header/message separator');
  const headers = object.content.slice(0, separator).split('\n');
  const match = /^object ([a-f0-9]+)\ntype (commit|tag)\ntag [^\n]+$/.exec(headers.slice(0, 3).join('\n'));
  if (!match || headers.slice(3).some(line => !/^tagger [^\r\n]+$/.test(line)) || headers.length > 4) throw new AuditError('metadata.tag', 'Malformed annotated tag headers');
  const target = oid(match[1]);
  const rawMessage = object.content.slice(separator + 2).replaceAll('\r\n', '\n');
  // Only a complete terminal armor block is signature material. A marker in
  // prose or attribution after a signature must never hide message trailers.
  const markers = []; let fence = null, offset = 0;
  for (const line of rawMessage.split('\n')) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delimiter) { if (!fence) fence = delimiter[1][0]; else if (delimiter[1][0] === fence) fence = null; }
    else if (!fence && /^-----BEGIN (PGP SIGNATURE|SSH SIGNATURE)-----[ \t]*$/.test(line)) markers.push(offset);
    offset += line.length + 1;
  }
  let message = rawMessage;
  if (markers.length) {
    if (markers.length !== 1) throw new AuditError('metadata.tag-signature', 'Multiple or nested unquoted signature blocks require metadata review');
    const marker = markers[0];
    const armor = /^-----BEGIN (PGP SIGNATURE|SSH SIGNATURE)-----\n([\s\S]*?)\n-----END \1-----$/.exec(rawMessage.slice(marker).trimEnd());
    if (!armor) throw new AuditError('metadata.tag-signature', 'Malformed or nonterminal signature block cannot hide tag-message attribution');
      const lines = armor[2].split('\n');
      if (!lines.some(line => /^[A-Za-z0-9+/]+={0,2}$/.test(line)) || lines.some(line => line && !/^[A-Za-z0-9+/]+={0,2}$|^=[A-Za-z0-9+/]{4}$/.test(line) && !(armor[1] === 'PGP SIGNATURE' && /^(Version|Comment|Charset|MessageID|Hash): [^\r\n]+$/.test(line)))) throw new AuditError('metadata.tag-signature', 'Malformed terminal signature armor cannot hide tag-message attribution');
      message = rawMessage.slice(0, marker).trimEnd();
  }
  tags.set(id, { target, targetType: match[2], taggerRaw: headers[3]?.slice(7), message });
  return peelCommit(repo, target, seen, tags, match[2]);
  } catch (error) { if (error instanceof AuditError) error.object ??= id; throw error; }
}
