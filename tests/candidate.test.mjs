import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { prepareCandidate } from '../src/candidate.mjs';
import { fixtureRoot, createRepo, commit, setRef, packageRoot, matrix } from '../src/fixtures.mjs';
import { git } from '../src/git.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/candidates'));
let serial = 0;
for (const method of ['merge', 'squash']) for (const kind of ['human', 'author', 'committer', 'trailer']) test(`controlled ${method}: final ${kind} metadata`, () => {
  const repo = createRepo(root, `${method}-${serial++}`), base = commit(repo), head = commit(repo, { parents: [base] }); setRef(repo, base);
  const good = 'Sample Contributor <contributor@example.invalid> 1700000000 +0000', bad = 'Claude <claude@example.invalid> 1700000000 +0000';
  const metadata = { author: kind === 'author' ? bad : good, committer: kind === 'committer' ? bad : good, message: kind === 'trailer' ? 'Edited final message\n\nCo-authored-by: Codex <codex@example.invalid>' : 'Final integration' };
  const result = prepareCandidate({ repo, base, head, tree: git(repo, ['rev-parse', `${head}^{tree}`]), method, metadata });
  assert.equal(result.exitCode, kind === 'human' ? 0 : 1); assert.equal(result.admission, false);
  assert.equal(git(repo, ['show-ref', '--hash', 'refs/heads/main']), base);
});
test('squash cannot hide prohibited proposed history; unimplemented rebase disabled', () => {
  const repo = createRepo(root, 'proposed'), base = commit(repo), head = commit(repo, { parents: [base], author: matrix.ai[0] });
  const options = { repo, base, head, tree: git(repo, ['rev-parse', `${head}^{tree}`]), method: 'squash', metadata: { author: 'Sample Contributor <c@example.invalid> 1700000000 +0000', committer: 'Sample Contributor <c@example.invalid> 1700000000 +0000', message: 'Clean final' } };
  assert.equal(prepareCandidate(options).exitCode, 1); assert.throws(() => prepareCandidate({ ...options, method: 'rebase' }));
});
