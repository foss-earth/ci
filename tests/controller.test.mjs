import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureRoot, packageRoot, createRepo, setRef } from '../src/fixtures.mjs';
import { git } from '../src/git.mjs';
import { loadPolicy, digest } from '../src/policy.mjs';
import { callerTemplate, consumerConfig } from '../src/templates.mjs';
import { prepareAdmission, controlledAdmission, GitLeaseTransport } from '../src/controller.mjs';
import { githubChecksGateway } from '../src/github-checks.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/controller')); let serial = 0;
function fixture() {
  const repo = createRepo(root, `subject-${serial++}`);
  const files = {};
  for (const dir of ['bin', 'src', 'policy', 'fixtures', 'scripts']) for (const name of readdirSync(resolve(packageRoot, dir))) files[`${dir}/${name}`] = digest(readFileSync(resolve(packageRoot, dir, name)));
  files['package.json'] = digest(readFileSync(resolve(packageRoot, 'package.json')));
  const artifact = Buffer.from('Synthetic immutable archive binding');
  const release = { schemaVersion: 1, executableSealVersion: 2, package: '@foss-earth/ci', version: 'synthetic', revision: '1'.repeat(40), artifactPath: `deps/foss-earth-ci-${'1'.repeat(40)}.tgz`, artifactSha256: digest(artifact), sizeBytes: artifact.length, policySha256: loadPolicy().sha256, files };
  mkdirSync(resolve(repo, 'deps')); writeFileSync(resolve(repo, release.artifactPath), artifact);
  mkdirSync(resolve(repo, '.github/workflows'), { recursive: true });
  writeFileSync(resolve(repo, '.attribution-release.json'), JSON.stringify(release)); writeFileSync(resolve(repo, '.attribution.json'), JSON.stringify(consumerConfig(release))); writeFileSync(resolve(repo, '.github/workflows/attribution-check.yml'), callerTemplate(release.revision));
  git(repo, ['add', '.']); git(repo, ['-c', 'user.name=Sample Contributor', '-c', 'user.email=contributor@example.invalid', 'commit', '--quiet', '-m', 'Clean baseline']);
  const base = git(repo, ['rev-parse', 'HEAD']); git(repo, ['checkout', '--quiet', '-b', 'proposal']); writeFileSync(resolve(repo, 'component.txt'), 'Candidate integration tree'); git(repo, ['add', 'component.txt']); git(repo, ['-c', 'user.name=Sample Contributor', '-c', 'user.email=contributor@example.invalid', 'commit', '--quiet', '-m', 'Clean proposal']);
  const head = git(repo, ['rev-parse', 'HEAD']); git(repo, ['checkout', '--quiet', '--detach', base]);
  const remote = resolve(root, `remote-${serial++}.git`); git(repo, ['clone', '--bare', '--no-hardlinks', repo, remote]);
  const config = { schemaVersion: 1, ciRelease: release, targets: { 'fixture/project': { source: remote, sourceBindingId: 'synthetic-local-source', admissionGuard: { id: 'synthetic-fixture-service', version: 'fixture-v1' }, protectedRef: 'refs/heads/main', publicationRefs: ['refs/heads/main', 'refs/heads/proposal'], allowedMethods: ['merge', 'squash'], ownerChecks: [{ name: 'owner / Installed common conformance', purpose: 'consumer-conformance', appId: 1, workflowPath: 'fixture/trusted/.github/workflows/owner.yml@' + '3'.repeat(40), workflowSha: '3'.repeat(40) }] } } };
  const human = 'Sample Contributor <contributor@example.invalid> 1700000000 +0000';
  return { repo, remote, base, head, config, input: { repo, target: 'fixture/project', proposalRef: 'refs/heads/proposal', expectedHead: head, method: 'merge', metadata: { author: human, committer: human, message: 'Exact final merge' }, config } };
}
function checkReceipt(f, candidate, changed = {}) {
  const release = f.config.ciRelease;
  return { ...f.config.targets['fixture/project'].ownerChecks[0], headSha: candidate, status: 'completed', conclusion: 'success', trustedJobProof: true, conformanceVerified: true, conformancePin: { revision: release.revision, artifactSha256: release.artifactSha256, policySha256: release.policySha256 }, ...changed };
}
function guardReceipt(request, changed = {}) {
  return { accepted: true, transactionId: 'synthetic-fixture-transaction', target: request.target, ref: request.protectedRef, old: request.expectedBase, new: request.candidate, proposalHead: request.proposal.expectedHead, publicationSnapshotSha256: request.publicationSnapshotSha256, checkWitnessDigest: request.checkWitnessDigest, ciPin: request.ciPin, guard: request.guard, ...changed };
}
// This stub exercises the trusted service contract in isolated local fixtures.
// Its reads/lease are not an implementation or qualification of a remote freeze.
function fixtureGuard(f) {
  return async request => {
    const transport = new GitLeaseTransport({ repo: f.repo, source: f.remote });
    const snapshot = [...transport.advertised()].map(([ref, oid]) => ({ ref, oid })).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
    assert.deepEqual(snapshot, request.publicationSnapshot);
    assert.equal(digest(JSON.stringify(snapshot)), request.publicationSnapshotSha256);
    assert.equal(git(f.repo, ['ls-remote', '--refs', f.remote, request.proposal.ref]).split('\t')[0], request.proposal.expectedHead);
    transport.publish(request.candidate, request.protectedRef, request.expectedBase);
    return guardReceipt(request);
  };
}
for (const method of ['merge', 'squash']) test(`clean ${method} staging and bound guarded-service admission contract`, async () => {
  const f = fixture(); f.input.method = method;
  const prepared = prepareAdmission(f.input); assert.equal(prepared.ready, true); assert.equal(prepared.tree, git(f.repo, ['rev-parse', `${f.head}^{tree}`]));
  const stage = await controlledAdmission({ input: f.input, phase: 'stage', publish: true }); assert.equal(stage.stagePublished, true); assert.equal(stage.admission, false);
  f.config.targets['fixture/project'].publicationRefs = stage.publicationRefsAfterStage;
  // Local selected refs are fetched from the exact source snapshot; no missing remote history hidden.
  git(f.repo, ['fetch', f.remote, `${stage.stageRef}:${stage.stageRef}`]);
  const readTrustedChecks = async () => [checkReceipt(f, prepared.candidate)];
  const result = await controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks, publishGuarded: fixtureGuard(f), publish: true });
  assert.equal(result.admission, true); assert.equal(git(f.repo, ['ls-remote', f.remote, 'refs/heads/main']).split('\t')[0], prepared.candidate);
});
test('admission has no unguarded protected-base lease fallback', async () => {
  const f = fixture(), prepared = prepareAdmission(f.input);
  await assert.rejects(controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks: async () => [checkReceipt(f, prepared.candidate)], publish: true }), /separately bound transaction/);
  assert.equal(git(f.remote, ['show-ref', '--hash', 'refs/heads/main']), f.base);
});
for (const drift of ['proposal', 'publication-ref']) test(`guard rejects ${drift} drift after controller's final audit`, async () => {
  const f = fixture(), prepared = prepareAdmission(f.input);
  const publishGuarded = async request => {
    git(f.remote, ['update-ref', drift === 'proposal' ? 'refs/heads/proposal' : 'refs/heads/new-publication', f.base]);
    return fixtureGuard(f)(request);
  };
  await assert.rejects(controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks: async () => [checkReceipt(f, prepared.candidate)], publishGuarded, publish: true }));
  assert.equal(git(f.remote, ['show-ref', '--hash', 'refs/heads/main']), f.base);
});
test('denied or mismatched service transaction receipts cannot claim admission', async () => {
  const f = fixture(), prepared = prepareAdmission(f.input);
  for (const changed of [{ accepted: false }, { transactionId: '' }, { target: 'other/project' }, { ref: 'refs/heads/proposal' }, { new: f.head }, { publicationSnapshotSha256: '0'.repeat(64) }, { proposalHead: f.base }, { guard: { id: 'unbound', version: 'fixture-v1' } }]) {
    await assert.rejects(controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks: async () => [checkReceipt(f, prepared.candidate)], publishGuarded: async request => guardReceipt(request, changed), publish: true }), /exact bound transaction receipt/);
  }
  assert.equal(git(f.remote, ['show-ref', '--hash', 'refs/heads/main']), f.base);
});
for (const field of ['author', 'committer', 'coauthor']) test(`final AI ${field} rejected before any staging branch publication`, async () => {
  const f = fixture(); const before = git(f.repo, ['ls-remote', '--refs', f.remote]);
  if (field === 'coauthor') f.input.metadata.message += '\n\nCo-authored-by: Claude <legacy-ai>';
  else f.input.metadata[field] = 'Claude <legacy-ai> 1700000000 +0000';
  const result = await controlledAdmission({ input: f.input, phase: 'stage', publish: true }); assert.equal(result.exitCode, 1); assert.equal(git(f.repo, ['ls-remote', '--refs', f.remote]), before);
});
test('lease rejects a concurrent ref change instead of overwriting it', () => {
  const f = fixture(), prepared = prepareAdmission(f.input); git(f.remote, ['update-ref', 'refs/heads/main', f.head, f.base]);
  assert.throws(() => new GitLeaseTransport({ repo: f.repo, source: f.remote }).publish(prepared.candidate, 'refs/heads/main', f.base));
  assert.equal(git(f.remote, ['show-ref', '--hash', 'refs/heads/main']), f.head);
});
test('explicit lease transport does not publish local follow-tags metadata', () => {
  const f = fixture(), prepared = prepareAdmission(f.input);
  const tag = git(f.repo, ['hash-object', '-w', '-t', 'tag', '--stdin'], `object ${prepared.candidate}\ntype commit\ntag local-only\ntagger Sample Contributor <contributor@example.invalid> 1700000000 +0000\n\nLocal tag is not selected publication\n`);
  git(f.repo, ['update-ref', 'refs/tags/local-only', tag]); git(f.repo, ['config', 'push.followTags', 'true']);
  new GitLeaseTransport({ repo: f.repo, source: f.remote }).publish(prepared.candidate, 'refs/heads/main', f.base);
  assert.equal(git(f.repo, ['ls-remote', '--refs', f.remote, 'refs/tags/local-only']), '');
});
test('untrusted targets, neutral/skipped/missing owner proof and base drift reject', async () => {
  const f = fixture(); assert.throws(() => prepareAdmission({ ...f.input, target: 'other/project' }));
  const prepared = prepareAdmission(f.input);
  for (const changed of [{ conclusion: 'skipped' }, { conclusion: 'neutral' }, { trustedJobProof: false }, { headSha: f.base }, { conformanceVerified: false }, { conformancePin: {} }]) {
    await assert.rejects(() => controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks: async () => [checkReceipt(f, prepared.candidate, changed)] }));
  }
  await assert.rejects(() => controlledAdmission({ input: f.input, phase: 'admit', candidate: prepared.candidate, readTrustedChecks: async () => { git(f.remote, ['update-ref', 'refs/heads/main', f.head, f.base]); return [checkReceipt(f, prepared.candidate)]; } }));
});
test('submitted caller replacement and installed-controller hash mismatch reject', () => {
  const f = fixture(); f.config.ciRelease.files['src/controller.mjs'] = '0'.repeat(64); assert.throws(() => prepareAdmission(f.input), /integrity mismatch/);
  const other = fixture(); git(other.repo, ['checkout', '--quiet', 'proposal']); writeFileSync(resolve(other.repo, '.github/workflows/attribution-check.yml'), 'name: Mutable skipped caller\n'); git(other.repo, ['add', '.github/workflows/attribution-check.yml']); git(other.repo, ['-c', 'user.name=Sample Contributor', '-c', 'user.email=contributor@example.invalid', 'commit', '--quiet', '-m', 'Synthetic caller replacement']);
  other.input.expectedHead = git(other.repo, ['rev-parse', 'HEAD']); git(other.repo, ['push', other.remote, 'refs/heads/proposal:refs/heads/proposal']);
  assert.throws(() => prepareAdmission(other.input), /separate trusted update path/);
});
for (const kind of ['replace', 'delete']) test(`ordinary proposal cannot ${kind} the protected dependency artifact`, () => {
  const f = fixture(); git(f.repo, ['checkout', '--quiet', 'proposal']);
  if (kind === 'delete') git(f.repo, ['rm', '--', f.config.ciRelease.artifactPath]); else writeFileSync(resolve(f.repo, f.config.ciRelease.artifactPath), 'Synthetic replacement artifact');
  git(f.repo, ['add', '.']); git(f.repo, ['-c', 'user.name=Sample Contributor', '-c', 'user.email=contributor@example.invalid', 'commit', '--quiet', '-m', 'Synthetic dependency replacement']);
  f.input.expectedHead = git(f.repo, ['rev-parse', 'HEAD']); git(f.repo, ['push', f.remote, 'refs/heads/proposal:refs/heads/proposal']);
  assert.throws(() => prepareAdmission(f.input), /separate trusted update path/); assert.equal(git(f.remote, ['show-ref', '--hash', 'refs/heads/main']), f.base);
});
test('GitHub metadata alone cannot prove a trusted job; witness verifier is mandatory', async () => {
  const candidate = '4'.repeat(40), workflowSha = '3'.repeat(40), workflowPath = 'fixture/trusted/.github/workflows/owner.yml@' + workflowSha;
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('/check-runs?') ? { check_runs: [{ name: 'owner / Domain checks', app: { id: 1 }, head_sha: candidate, status: 'completed', conclusion: 'success', check_suite: { id: 10 }, details_url: 'https://github.com/fixture/project/actions/runs/20/job/30' }] } : { id: 20, head_sha: candidate, check_suite_id: 10, status: 'completed', referenced_workflows: [{ path: workflowPath, sha: workflowSha }] } });
  const input = { target: 'fixture/project', candidate };
  assert.equal((await githubChecksGateway({ token: 'synthetic-local-token', fetchImpl })(input))[0].trustedJobProof, false);
  assert.equal((await githubChecksGateway({ token: 'synthetic-local-token', fetchImpl, verifyTrustedJob: async ({ jobId }) => jobId === 30 })(input))[0].trustedJobProof, true);
});
