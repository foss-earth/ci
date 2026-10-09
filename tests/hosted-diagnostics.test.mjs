import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fixtureRoot, packageRoot, createRepo } from '../src/fixtures.mjs';
import { AuditError, git } from '../src/git.mjs';
import { hostedFailure } from '../src/hosted-diagnostics.mjs';
import { hostedConformance } from '../src/hosted-conformance.mjs';
import { initializeHostedSubject } from '../src/hosted-subject.mjs';
import { callerTemplate, consumerConfig } from '../src/templates.mjs';
import { digest } from '../src/policy.mjs';
import { gunzipSync } from 'node:zlib';
import { readReleaseArtifact } from '../src/release.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/hosted-diagnostics'));
const original = JSON.parse(git(packageRoot, ['show', 'ec37278fc6675166305465a7447ec33808cb4e3c:.attribution-release.json']));
const release = { ...original, artifactPath: `deps/foss-earth-ci-${original.revision}.tgz` };
const archive = readFileSync(resolve(packageRoot, 'build/artifacts', release.revision, 'foss-earth-ci-0.1.0.tgz'));
assert.equal(digest(archive), release.artifactSha256); assert.equal(archive.length, release.sizeBytes);

test('hosted failure reports only allowlisted stage/rule/status without exception or environment data', () => {
  const secret = 'synthetic-private-token person@example.invalid /private/fixture/path';
  const error = new AuditError('history.config-read', secret); error.status = 128; error.stderr = secret; error.object = secret;
  const output = hostedFailure(error, 'fetch-publication'); assert.equal(output.exitCode, 2); assert.equal(output.clean, false); assert.equal(output.complete, false); assert.equal(output.errors[0].rule, 'history.config-read'); assert.equal(output.errors[0].stage, 'fetch-publication'); assert.equal(output.errors[0].status, 128); assert.equal(JSON.stringify(output).includes(secret), false);
  const unknown = new AuditError(secret, secret); unknown.status = secret;
  const hidden = hostedFailure(unknown, secret); assert.equal(hidden.errors[0].rule, 'hosted.failure'); assert.equal(hidden.errors[0].stage, 'unknown'); assert.equal(Object.hasOwn(hidden.errors[0], 'status'), false); assert.equal(JSON.stringify(hidden).includes(secret), false);
  assert.equal(hostedFailure(Object.assign(new Error(secret), { rule: 'history.git-failure', status: 128 }), 'initialize-subject').errors[0].rule, 'hosted.failure');
});
for (const kind of ['malformed-event', 'wrong-repository']) test(`actual hosted bin identifies ${kind} before any fetch`, () => {
  const cwd = resolve(root, kind); mkdirSync(cwd); const event = resolve(cwd, 'event.json'); writeFileSync(event, kind === 'malformed-event' ? 'synthetic-private-token-invalid-json' : '{}');
  const run = spawnSync(process.execPath, [resolve(packageRoot, 'bin/hosted.mjs')], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event, SOURCE_REPOSITORY: 'fixture/source', GITHUB_REPOSITORY: 'fixture/other', GITHUB_EVENT_NAME: 'push' } });
  assert.equal(run.status, 2); const result = JSON.parse(run.stdout); assert.equal(result.errors[0].stage, kind === 'malformed-event' ? 'read-event' : 'validate-event'); assert.equal(run.stdout.includes('synthetic-private-token'), false); assert.equal(run.stdout.includes(cwd), false); assert.equal(existsSync(resolve(cwd, 'build')), false);
});

function subjectFixture(label, descriptor = release, config = consumerConfig(descriptor)) {
  const source = createRepo(root, label);
  git(source, ['-c', 'user.name=Fixture Human', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'Synthetic publication ancestry']);
  mkdirSync(resolve(source, '.github/workflows'), { recursive: true });
  mkdirSync(resolve(source, 'deps')); writeFileSync(resolve(source, release.artifactPath), archive);
  writeFileSync(resolve(source, '.attribution-release.json'), JSON.stringify(descriptor)); writeFileSync(resolve(source, '.attribution.json'), typeof config === 'string' ? config : JSON.stringify(config)); writeFileSync(resolve(source, '.github/workflows/attribution-check.yml'), callerTemplate(descriptor.revision));
  git(source, ['add', '.']); git(source, ['-c', 'user.name=Fixture Human', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic hosted consumer fixture']);
  const head = git(source, ['rev-parse', 'HEAD']), output = resolve(root, `${label}-hosted`), { repo } = initializeHostedSubject(output);
  git(repo, ['fetch', '--no-write-fetch-head', '--no-tags', pathToFileURL(source).href, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
  return { subject: repo, baseline: head, head, root: output, source };
}
let shallowTool;
function trustedShallowTool() {
  if (shallowTool) return shallowTool;
  shallowTool = resolve(root, 'trusted-shallow');
  const origin = resolve(root, 'trusted-fixture-origin.git'); mkdirSync(origin); git(origin, ['init', '--bare', '--quiet']);
  git(origin, ['fetch', '--no-write-fetch-head', '--depth', '1', pathToFileURL(packageRoot).href, `${release.revision}:refs/heads/trusted`]);
  git(root, ['clone', '--no-hardlinks', '--depth', '1', '--branch', 'trusted', '--', pathToFileURL(origin).href, shallowTool]);
  assert.equal(git(shallowTool, ['rev-parse', 'HEAD']), release.revision); assert.equal(git(shallowTool, ['rev-parse', '--is-shallow-repository']), 'true');
  return shallowTool;
}
test('actual hosted bin fetches a full local publication then runs exact installed entry and19cases from a shallow trusted checkout', () => {
  const subject = subjectFixture('installed-positive'), tool = trustedShallowTool();
  const transport = resolve(root, 'local-transport'); mkdirSync(transport);
  const found = spawnSync('which', ['git'], { encoding: 'utf8' }); assert.equal(found.status, 0);
  const realGit = found.stdout.trim(); assert.ok(realGit.startsWith('/')); assert.equal(realGit.includes('\n'), false);
  // Only the fixed synthetic URL is redirected. All other Git operations use
  // the real Git binary. This is fixture transport, not a production bypass.
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const shim = `#!/bin/bash\nargs=()\nfor arg in "$@"; do\n  case "$arg" in\n    https://github.com/fixture/source.git) args+=(${quote(pathToFileURL(subject.source).href)});;\n    http://*|https://*) exit 97;;\n    *) args+=("$arg");;\n  esac\ndone\nexec ${quote(realGit)} "\${args[@]}"\n`;
  writeFileSync(resolve(transport, 'package.json'), '{"type":"module"}'); writeFileSync(resolve(transport, 'git'), shim, { mode: 0o755 });
  const event = resolve(root, 'positive-event.json'); writeFileSync(event, JSON.stringify({ after: subject.head }));
  const run = spawnSync(process.execPath, [resolve(packageRoot, 'bin/hosted.mjs')], { cwd: tool, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PATH: `${transport}:${process.env.PATH ?? ''}`, NODE_OPTIONS: '', NODE_PATH: '', GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'push', SOURCE_REPOSITORY: 'fixture/source', GITHUB_REPOSITORY: 'fixture/source' } });
  assert.equal(run.status, 0); const result = JSON.parse(run.stdout);
  assert.equal(result.exitCode, 0); assert.equal(result.complete, true); assert.equal(result.clean, true); assert.equal(result.scope.commitCount, 2); assert.deepEqual(result.scope.selectedRefs.map(ref => ref.name), ['refs/heads/main']);
  assert.equal(git(resolve(tool, 'build/hosted/subject.git'), ['rev-parse', '--is-shallow-repository']), 'false');
  assert.equal(result.conformance.exitCode, 0); assert.equal(result.conformance.tests.length, 19); assert.ok(result.conformance.tests.every(test => test.pass)); assert.deepEqual(result.conformance.consumerSource, { baseline: subject.baseline, head: subject.head });
  assert.deepEqual(JSON.parse(readFileSync(resolve(tool, 'build/hosted/audit.json'), 'utf8')), result);
});
test('platform gzip OS-byte variation changes the pinned hash while preserving every tar byte', () => {
  assert.equal(archive[9], 19); const linuxHeader = Buffer.from(archive); linuxHeader[9] = 3;
  assert.notEqual(digest(linuxHeader), release.artifactSha256); assert.deepEqual(gunzipSync(linuxHeader), gunzipSync(archive));
  const subject = subjectFixture('portable-exact-blob'); assert.deepEqual(readReleaseArtifact(subject.subject, subject.baseline, release), archive);
});
for (const kind of ['missing', 'unsafe', 'different-source']) test(`protected artifact path ${kind} fails without consumer mutation`, () => {
  const descriptor = { ...release, artifactPath: kind === 'missing' ? undefined : kind === 'unsafe' ? '../private.tgz' : `deps/foss-earth-ci-${'1'.repeat(40)}.tgz` };
  const subject = subjectFixture(`path-${kind}`, descriptor); let stage;
  assert.throws(() => hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: value => { stage = value; }, runInstall: () => assert.fail('Must not install') }), error => hostedFailure(error, stage).errors[0].rule === 'hosted.artifact-location');
  assert.equal(existsSync(resolve(subject.root, 'consumer')), false);
});
for (const kind of ['executable-map', 'policy-digest', 'omitted-executable']) test(`descriptor ${kind} cannot reseal different bytes under the trusted source pin`, () => {
  const descriptor = { ...release, files: { ...release.files } };
  if (kind === 'executable-map') descriptor.files['bin/attribution.mjs'] = '0'.repeat(64);
  if (kind === 'policy-digest') descriptor.policySha256 = '0'.repeat(64);
  if (kind === 'omitted-executable') delete descriptor.files['bin/attribution.mjs'];
  const subject = subjectFixture(`source-${kind}`, descriptor); let stage;
  assert.throws(() => hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: value => { stage = value; }, runInstall: () => assert.fail('Must not install') }), error => hostedFailure(error, stage).errors[0].rule === 'hosted.trusted-source');
  assert.equal(stage, 'verify-trusted-source'); assert.equal(existsSync(resolve(subject.root, 'consumer')), false);
});
for (const kind of ['absent', 'symlink']) test(`protected ${kind} artifact cannot fall back to valid proposal bytes`, () => {
  const subject = subjectFixture(`no-head-fallback-${kind}`);
  git(subject.source, ['rm', '--', release.artifactPath]);
  mkdirSync(resolve(subject.source, 'deps'), { recursive: true });
  if (kind === 'symlink') symlinkSync('missing-target', resolve(subject.source, release.artifactPath));
  git(subject.source, ['add', '.']); git(subject.source, ['-c', 'user.name=Fixture Human', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic missing protected dependency']);
  subject.baseline = git(subject.source, ['rev-parse', 'HEAD']); git(subject.source, ['rm', '--ignore-unmatch', '--', release.artifactPath]);
  mkdirSync(resolve(subject.source, 'deps'), { recursive: true });
  writeFileSync(resolve(subject.source, release.artifactPath), archive); git(subject.source, ['add', '.']); git(subject.source, ['-c', 'user.name=Fixture Human', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic proposal artifact']);
  subject.head = git(subject.source, ['rev-parse', 'HEAD']); git(subject.subject, ['fetch', '--no-write-fetch-head', pathToFileURL(subject.source).href, '+refs/heads/*:refs/heads/*']);
  assert.deepEqual(readReleaseArtifact(subject.subject, subject.head, release), archive);
  assert.throws(() => readReleaseArtifact(subject.subject, subject.baseline, release), /regular Git blob/);
  let stage;
  assert.throws(() => hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: value => { stage = value; }, runInstall: () => assert.fail('Valid proposal bytes must not replace missing protected bytes') }), error => hostedFailure(error, stage).errors[0].rule === 'hosted.artifact-location');
  assert.equal(existsSync(resolve(subject.root, 'consumer')), false);
});
for (const [kind, replacement] of [['digest', { artifactSha256: '0'.repeat(64) }], ['size', { sizeBytes: release.sizeBytes + 1 }]]) test(`artifact ${kind}-only mismatch is identified before installation with preserved subject evidence`, () => {
  const subject = subjectFixture(`artifact-${kind}-mismatch`, { ...release, ...replacement }); let stage;
  assert.throws(() => hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: value => { stage = value; }, runInstall: () => assert.fail('Unverified artifact must not install') }), error => hostedFailure(error, stage).errors[0].rule === 'hosted.artifact-digest');
  assert.equal(stage, 'verify-trusted-artifact'); assert.equal(existsSync(resolve(subject.root, 'consumer')), false); assert.equal(git(subject.subject, ['rev-parse', '--is-bare-repository']), 'true');
});
test('malformed consumer-policy JSON returns only a fixed conformance summary after exact installation', () => {
  const secret = 'synthetic-private-token person@example.invalid /private/fixture/path';
  const subject = subjectFixture('malformed-consumer-policy', release, `{"secret":"${secret}"`), stages = [];
  const result = hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: stage => stages.push(stage) });
  assert.equal(result.exitCode, 2); assert.equal(result.complete, false); assert.equal(result.clean, false); assert.deepEqual(result.tests, []);
  assert.deepEqual(result.errors, ['Installed common consumer conformance failed; inspect retained controlled evidence']); assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(JSON.stringify(result).includes(subject.root), false);
  assert.equal(stages.at(-1), 'installed-entry-conformance'); assert.equal(existsSync(resolve(subject.root, 'common.tgz')), true); assert.equal(existsSync(resolve(subject.root, 'consumer/node_modules/@foss-earth/ci/bin/attribution.mjs')), true);
});
test('installed artifact command failure exposes only stage/status and retains preparation bytes', () => {
  const subject = subjectFixture('install-failure'); let stage, diagnostic;
  try { hostedConformance({ ...subject, toolRoot: trustedShallowTool(), onStage: value => { stage = value; }, runInstall: (_command, args) => { assert.ok(args.includes('--ignore-scripts')); return { status: 7, stderr: 'synthetic-private-token person@example.invalid /private/fixture/path' }; } }); assert.fail('Installation must fail'); }
  catch (error) { diagnostic = hostedFailure(error, stage); }
  assert.equal(diagnostic.errors[0].rule, 'hosted.artifact-install'); assert.equal(diagnostic.errors[0].stage, 'install-trusted-artifact'); assert.equal(diagnostic.errors[0].status, 7); assert.equal(JSON.stringify(diagnostic).includes('synthetic-private-token'), false); assert.equal(existsSync(resolve(subject.root, 'common.tgz')), true);
});
