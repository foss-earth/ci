import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, cpSync, renameSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { conformance } from '../src/conformance.mjs';
import { callerTemplate, consumerConfig, policyRule, policyRationale, contributionTemplate, agentTemplate } from '../src/templates.mjs';
import { fixtureRoot, packageRoot, createRepo, matrix } from '../src/fixtures.mjs';
import { digest } from '../src/policy.mjs';

const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/consumers'));
function consumer(kind) {
  const repo = createRepo(root, kind); mkdirSync(resolve(repo, '.github/workflows'), { recursive: true });
  writeFileSync(resolve(repo, '.gitignore'), '/build/\n/node_modules/\n');
  writeFileSync(resolve(repo, 'package.json'), JSON.stringify({ name: `synthetic-${kind}`, scripts: { attribution: 'node node_modules/@foss-earth/ci/bin/attribution.mjs' } }));
  const installed = resolve(repo, 'node_modules/@foss-earth/ci'); mkdirSync(installed, { recursive: true });
  const files = {};
  for (const directory of ['bin', 'src', 'policy', 'fixtures', 'scripts']) {
    cpSync(resolve(packageRoot, directory), resolve(installed, directory), { recursive: true });
    for (const file of readdirSync(resolve(installed, directory))) files[`${directory}/${file}`] = digest(readFileSync(resolve(installed, directory, file)));
  }
  cpSync(resolve(packageRoot, 'package.json'), resolve(installed, 'package.json')); files['package.json'] = digest(readFileSync(resolve(installed, 'package.json')));
  const release = { schemaVersion: 1, executableSealVersion: 2, revision: '1'.repeat(40), artifactSha256: '2'.repeat(64), policySha256: files['policy/attribution-v1.json'], files };
  writeFileSync(resolve(repo, '.attribution.json'), JSON.stringify(consumerConfig(release)));
  writeFileSync(resolve(repo, '.github/workflows/attribution-check.yml'), callerTemplate(release.revision));
  writeFileSync(resolve(repo, kind === 'code' ? 'example.mjs' : kind === 'documentation' ? 'README.md' : 'data.json'), kind === 'data-content' ? '{}' : 'Synthetic consumer fixture\n');
  return { repo, release, installed };
}
for (const kind of matrix.consumerKinds) test(`${kind} invokes its installed entry point and the shared brand/field matrix`, () => {
  const { repo, release } = consumer(kind);
  const result = conformance({ consumer: repo, release, outputRoot: resolve(repo, 'build/conformance') });
  assert.equal(result.exitCode, 0); assert.equal(result.tests.length, 19);
});
test('reject mutable pin, path-filtered/skipped caller and installed validator replacement', () => {
  const { repo, release, installed } = consumer('tampering');
  const options = { consumer: repo, release, outputRoot: resolve(repo, 'build/conformance') };
  const callerPath = resolve(repo, '.github/workflows/attribution-check.yml');
  writeFileSync(callerPath, callerTemplate(release.revision).replace('  pull_request:', '  pull_request:\n    paths: [src/**]'));
  assert.equal(conformance(options).exitCode, 2);
  writeFileSync(callerPath, callerTemplate(release.revision).replace(`@${release.revision}`, '@main')); assert.equal(conformance(options).exitCode, 2);
  writeFileSync(callerPath, callerTemplate(release.revision));
  writeFileSync(resolve(installed, 'bin/attribution.mjs'), 'process.exit(0);\n'); assert.equal(conformance(options).exitCode, 2);
});
test('templates contain exact policy rule and shared caller has no skips', () => {
  const canonical = JSON.parse(readFileSync(resolve(packageRoot, 'policy/attribution-v1.json'), 'utf8'));
  assert.equal(policyRule, 'You cannot have AI as a co-author, or your contributions will be rejected.');
  assert.equal(policyRule, canonical.rule); assert.equal(policyRationale, Object.values(canonical.rationale).join('\n\n'));
  assert.ok(contributionTemplate.includes(policyRationale)); assert.ok(agentTemplate.includes('Never add AI author, committer or coauthor'));
  assert.ok(agentTemplate.includes('advertising')); assert.ok(agentTemplate.includes('accuracy, review responses, provenance and rights'));
  assert.ok(contributionTemplate.includes(policyRule)); assert.ok(agentTemplate.includes(policyRule));
  assert.equal(contributionTemplate.includes('YOU CANNOT HAVE AI AS A CO-AUTHOR'), false); assert.equal(agentTemplate.includes('YOU CANNOT HAVE AI AS A CO-AUTHOR'), false);
  assert.equal(contributionTemplate.split(policyRule).length, 2); assert.ok(contributionTemplate.indexOf(policyRule) > contributionTemplate.indexOf('## Pull requests')); assert.ok(contributionTemplate.indexOf(policyRule) > contributionTemplate.indexOf('## Commit attribution'));
  const caller = callerTemplate('a'.repeat(40)); assert.ok(caller.includes('merge_group:')); assert.ok(caller.includes('  push:'));
  assert.ok(!/paths:|paths-ignore:|if:|workflow_dispatch:|secrets:/.test(caller));
  assert.throws(() => callerTemplate('main'));
});
test('exact installed conformance rejects an intact neighboring source symlink', () => {
  const { repo, release, installed } = consumer('source-link'); const retained = resolve(repo, 'build/retained-component'); mkdirSync(resolve(repo, 'build'), { recursive: true }); renameSync(installed, retained); symlinkSync(retained, installed, 'dir');
  const result = conformance({ consumer: repo, release, outputRoot: resolve(repo, 'build/conformance') }); assert.equal(result.exitCode, 2); assert.ok(result.errors.some(error => error.includes('source symlink')));
});
for (const path of ['package.json', 'scripts/bootstrap-self.mjs']) for (const kind of ['omission', 'mutation']) test(`complete executable seal rejects ${path} ${kind}`, () => {
  const { repo, release, installed } = consumer(`full-seal-${path.replaceAll('/', '-')}-${kind}`);
  if (kind === 'omission') delete release.files[path]; else writeFileSync(resolve(installed, path), 'Synthetic corrupt executable contract');
  const result = conformance({ consumer: repo, release, outputRoot: resolve(repo, 'build/conformance') }); assert.equal(result.exitCode, 2); assert.equal(result.complete, false); assert.equal(result.tests.length, 0);
});
