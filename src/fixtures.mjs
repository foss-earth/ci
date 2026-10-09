import { mkdirSync, mkdtempSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, AuditError } from './git.mjs';
import { readJson } from './audit.mjs';

export const matrix = readJson(new URL('../fixtures/matrix-v1.json', import.meta.url));
export const human = matrix.humans[0];
export function fixtureRoot(owner, requested) {
  const root = resolve(requested);
  const relation = relative(resolve(owner), root);
  if (!relation || relation.startsWith('..') || isAbsolute(relation) || !relation.split('/').includes('build')) throw new AuditError('fixture.location', 'Synthetic histories must be under the owner ignored build directory');
  for (let path = root; path !== dirname(path); path = dirname(path)) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new AuditError('fixture.symlink', 'Fixture path may not traverse symlinks');
  git(owner, ['check-ignore', '--', root]);
  mkdirSync(root, { recursive: true });
  return mkdtempSync(resolve(root, 'run-'));
}
export function createRepo(root, label) {
  const repo = resolve(root, label);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  return repo;
}
export function commit(repo, { author = human, committer = human, message = 'Synthetic contribution', parents = [], rawHeaders } = {}) {
  const tree = git(repo, ['hash-object', '-w', '-t', 'tree', '--stdin'], Buffer.alloc(0));
  const identity = i => `${i.name} <${i.email}> 1700000000 +0000`;
  const headers = rawHeaders ?? [`tree ${tree}`, ...parents.map(p => `parent ${p}`), `author ${identity(author)}`, `committer ${identity(committer)}`].join('\n');
  return git(repo, ['hash-object', '-w', '-t', 'commit', '--stdin', '--literally'], `${headers}\n\n${message}\n`);
}
export function setRef(repo, id, ref = 'refs/heads/main') { git(repo, ['update-ref', ref, id]); }
export function publication(repo, refs = ['refs/heads/main']) {
  return { schemaVersion: 1, source: { id: 'synthetic-publication-source', location: repo }, refs: refs.map(name => ({ name, oid: git(repo, ['show-ref', '--verify', '--hash', name]) })) };
}
export function writeScope(repo, refs) {
  const path = resolve(repo, 'publication.json');
  writeFileSync(path, JSON.stringify(publication(repo, refs)));
  return path;
}
export const packageRoot = fileURLToPath(new URL('..', import.meta.url));
