import { readFileSync } from 'node:fs';
import { AuditError, git, repositorySafety, rawObject, peelCommit, oid, refName } from './git.mjs';
import { loadPolicy, parseIdentity, identityRule, trailers, digest } from './policy.mjs';

export function parseCommit(content) {
  const separator = content.indexOf('\n\n');
  if (separator < 0) throw new AuditError('metadata.commit', 'Missing commit header/message separator');
  const headers = new Map();
  let previous;
  for (const line of content.slice(0, separator).split('\n')) {
    if (line.startsWith(' ') && previous && !['author', 'committer', 'tree', 'parent'].includes(previous)) continue;
    const m = /^([a-z][a-z0-9-]*) (.*)$/.exec(line);
    if (!m) throw new AuditError('metadata.header', 'Malformed raw commit header');
    previous = m[1];
    headers.set(m[1], [...headers.get(m[1]) ?? [], m[2]]);
  }
  for (const key of ['tree', 'author', 'committer']) if (headers.get(key)?.length !== 1) throw new AuditError('metadata.header', `Commit must have one ${key} header`);
  oid(headers.get('tree')[0]);
  const identity = field => { try { return parseIdentity(headers.get(field)[0], true); } catch (error) { if (error instanceof AuditError) error.field = field; throw error; } };
  return { author: identity('author'), committer: identity('committer'), parents: (headers.get('parent') ?? []).map(oid), message: content.slice(separator + 2) };
}
export function walk(repo, heads) {
  const commits = new Map(), pending = [...heads];
  while (pending.length) {
    const id = pending.pop();
    if (commits.has(id)) continue;
    try {
    const object = rawObject(repo, id);
    if (object.type !== 'commit') throw new AuditError('metadata.parent-type', 'Commit ancestry contains a noncommit object');
    const commit = parseCommit(object.content);
    commits.set(id, commit);
    pending.push(...commit.parents);
    } catch (error) { if (error instanceof AuditError) error.object ??= id; throw error; }
  }
  return commits;
}
export function publicationScope(repo, manifest, tags = new Map()) {
  if (manifest.schemaVersion !== 1 || !manifest.source || typeof manifest.source.id !== 'string' || !manifest.source.id || typeof manifest.source.location !== 'string' || !manifest.source.location || manifest.source.location.startsWith('-') || /[\r\n\0]/.test(manifest.source.location) || !Array.isArray(manifest.refs) || !manifest.refs.length) throw new AuditError('scope.manifest', 'Publication manifest requires source id/location and an explicit nonempty ref list');
  if (new Set(manifest.refs.map(r => r.name)).size !== manifest.refs.length) throw new AuditError('scope.duplicate-ref', 'Duplicate selected publication ref');
  const source = manifest.source.location;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^(https|ssh|file):\/\//.test(source)) throw new AuditError('scope.source-protocol', 'External Git helpers and unreviewed source protocols are forbidden');
  if (/^https:\/\//.test(source) && (new URL(source).username || new URL(source).password || new URL(source).search)) throw new AuditError('scope.source-credentials', 'Source URLs must not contain credentials or query tokens');
  // Source is explicit, never guessed from an origin or a default branch. No URL is logged.
  const advertised = new Map(git(repo, ['ls-remote', '--refs', '--', manifest.source.location]).split('\n').filter(Boolean).map(line => line.split('\t').reverse()));
  return manifest.refs.map(entry => {
    refName(entry.name); oid(entry.oid);
    const actual = git(repo, ['show-ref', '--verify', '--hash', entry.name]);
    if (actual !== entry.oid || advertised.get(entry.name) !== entry.oid) throw new AuditError('scope.source-mismatch', 'Selected local ref or intended publication source differs from the explicit snapshot');
    const commit = peelCommit(repo, entry.oid, new Set(), tags);
    if (entry.commit !== undefined && oid(entry.commit) !== commit) throw new AuditError('scope.peel-mismatch', 'Annotated-tag commit differs from snapshot');
    return { name: entry.name, oid: entry.oid, commit };
  });
}
export function audit({ repo, mode, publication, base, head, config }) {
  const result = { schemaVersion: 1, tool: '@foss-earth/ci', mode, complete: false, clean: false, scope: {}, violations: [], errors: [] };
  try {
    const policy = loadPolicy(config);
    result.policy = { id: policy.id, version: policy.version, sha256: policy.sha256, identityMode: policy.mode };
    repositorySafety(repo);
    let checked;
    const tags = new Map();
    if (mode === 'publication') {
      const refs = publicationScope(repo, publication, tags);
      result.scope = { sourceId: publication.source.id, manifestSha256: digest(JSON.stringify(publication)), selectedRefs: refs, annotatedTags: [...tags].map(([id, tag]) => ({ oid: id, target: tag.target, targetType: tag.targetType, taggerPresent: tag.taggerRaw !== undefined })), semantics: 'Every reachable commit and every annotated tag in the selected tag chains of exactly these publication branches/tags; no silent exclusions' };
      checked = walk(repo, refs.map(r => r.commit));
    } else if (mode === 'range') {
      oid(base); oid(head);
      const ancestors = walk(repo, [base]), proposed = walk(repo, [head]);
      if (!proposed.has(base)) throw new AuditError('scope.unrelated-base', 'Proposed head must descend from the explicit base');
      checked = new Map([...proposed].filter(([id]) => !ancestors.has(id)));
      result.scope = { base, head, semantics: 'All commits reachable from head excluding commits reachable from base; not a full publication audit' };
    } else throw new AuditError('scope.mode', 'Use publication or range mode explicitly');
    result.scope.commitCount = checked.size;
    result.scope.commitSetSha256 = digest([...checked.keys()].sort().join('\n'));
    result.scope.annotatedTagCount = tags.size;
    result.scope.checkedObjectSetSha256 = digest([...checked.keys(), ...tags.keys()].sort().join('\n'));
    const recordedIdentity = (raw, header, object, field) => {
      try { return parseIdentity(raw, header); }
      catch (error) { if (error instanceof AuditError) { error.object = object; error.field = field; } throw error; }
    };
    for (const [id, commit] of checked) {
      for (const field of ['author', 'committer']) {
        const rule = identityRule(commit[field], policy);
        if (rule) result.violations.push({ commit: id, field, rule, repair: 'Review recorded attribution and submit permitted metadata; do not invent a human identity' });
      }
      for (const trailer of trailers(commit.message, policy)) {
        const rule = identityRule(recordedIdentity(trailer.value, false, id, `trailer.${trailer.key}`), policy);
        if (rule) result.violations.push({ commit: id, field: `trailer.${trailer.key}`, rule, repair: 'Remove prohibited attribution; preserve legitimate human credit' });
      }
    }
    for (const [id, tag] of tags) {
      const taggerRule = tag.taggerRaw === undefined ? policy.mode === 'approved' ? 'attribution.unapproved-identity' : null : identityRule(recordedIdentity(tag.taggerRaw, true, id, 'tagger'), policy);
      if (taggerRule) result.violations.push({ object: id, objectType: 'tag', field: 'tagger', rule: taggerRule, repair: 'Review recorded tagger attribution; preserve historical human identity; do not invent one' });
      for (const trailer of trailers(tag.message, policy)) {
        const rule = identityRule(recordedIdentity(trailer.value, false, id, `trailer.${trailer.key}`), policy);
        if (rule) result.violations.push({ object: id, objectType: 'tag', field: `trailer.${trailer.key}`, rule, repair: 'Remove prohibited annotated-tag attribution through the coordinator reviewed publication path' });
      }
    }
    // Check again so concurrent ref changes cannot produce an accepted stale receipt.
    if (mode === 'publication') publicationScope(repo, publication);
    result.complete = true;
    result.clean = result.violations.length === 0;
  } catch (error) {
    result.errors.push({ rule: error instanceof AuditError ? error.rule : 'audit.failure', detail: error instanceof AuditError ? error.message : 'Audit failed to read or validate inputs', ...error instanceof AuditError && error.object ? { object: error.object } : {}, ...error instanceof AuditError && error.field ? { field: error.field } : {} });
  }
  result.exitCode = !result.complete ? 2 : result.clean ? 0 : 1;
  return result;
}
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
