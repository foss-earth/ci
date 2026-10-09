import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureRoot, packageRoot, createRepo, commit, setRef, publication } from '../src/fixtures.mjs';
import { audit } from '../src/audit.mjs';
import { parseIdentity, identityRule, loadPolicy } from '../src/policy.mjs';
import { initializeHostedSubject } from '../src/hosted-subject.mjs';
import { git } from '../src/git.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/legacy-hosted'));
test('fresh hosted output root creates subject directory before git -C initialization', () => {
  const output = resolve(root, 'entirely-fresh'); assert.equal(existsSync(output), false);
  const { repo } = initializeHostedSubject(output);
  assert.equal(git(repo, ['rev-parse', '--is-bare-repository']), 'true');
});
test('preserve valid legacy opaque/empty Git addresses and deny AI names independently', () => {
  for (const [index, email] of ['legacy-user', '', 'legacy opaque identifier'].entries()) {
    const repo = createRepo(root, `legacy-${index}`), human = { name: 'Legacy Human', email };
    setRef(repo, commit(repo, { author: human, committer: human, message: `Historical fixture\n\nCo-authored-by: Legacy Human <${email}>` }));
    const input = { repo, mode: 'publication', publication: publication(repo), config: { extraForbiddenDomains: ['synthetic-ai.invalid'] } };
    assert.equal(audit(input).exitCode, 0);
    assert.equal(audit({ ...input, config: { mode: 'approved' } }).exitCode, 1);
    assert.equal(audit({ ...input, config: { mode: 'approved', approvedIdentities: [{ ...human, kind: 'human', review: 'reviewed synthetic historical inventory' }] } }).exitCode, 0);
    setRef(repo, commit(repo, { author: { name: 'Claude', email }, committer: human }));
    assert.equal(audit({ ...input, publication: publication(repo) }).exitCode, 1);
  }
});
test('opaque addresses do not relax malformed delimiter or metadata rejection', () => {
  for (const value of ['Legacy Human legacy-user', 'Legacy Human <legacy-user', 'Legacy Human legacy-user>', 'Legacy Human <<legacy-user>>', 'Legacy Human <legacy> extra', '<legacy-user>']) assert.throws(() => parseIdentity(value));
  assert.equal(identityRule(parseIdentity('Codex <legacy-user>'), loadPolicy()), 'attribution.ai-identity');
});
test('malformed commit trailer reports the affected object and field without identity leakage', () => {
  const privateFixtureValue = 'Synthetic sensitive attribution value';
  const repo = createRepo(root, 'malformed-trailer'), head = commit(repo, { message: `Synthetic contribution\n\nCo-authored-by: ${privateFixtureValue}` }); setRef(repo, head);
  const result = audit({ repo, mode: 'publication', publication: publication(repo) });
  assert.equal(result.exitCode, 2); assert.equal(result.errors[0].object, head); assert.equal(result.errors[0].field, 'trailer.coauthoredby');
  assert.equal(JSON.stringify(result).includes(privateFixtureValue), false);
});
