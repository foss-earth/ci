import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { conformance } from '../src/conformance.mjs';
import { callerTemplate, consumerConfig, policyRule, contributionTemplate, agentTemplate } from '../src/templates.mjs';
import { fixtureRoot, packageRoot, createRepo, matrix } from '../src/fixtures.mjs';
import { digest } from '../src/policy.mjs';

const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/consumers'));
function consumer(kind) {
  const repo = createRepo(root, kind); mkdirSync(resolve(repo, '.github/workflows'), { recursive: true });
  writeFileSync(resolve(repo, '.gitignore'), '/build/\n/node_modules/\n');
  writeFileSync(resolve(repo, 'package.json'), JSON.stringify({ name: `synthetic-${kind}`, scripts: { attribution: 'node node_modules/@foss-earth/ci/bin/attribution.mjs' } }));
  const installed = resolve(repo, 'node_modules/@foss-earth/ci'); mkdirSync(installed, { recursive: true });
  const files = {};
  for (const directory of ['bin', 'src', 'policy', 'fixtures']) {
    cpSync(resolve(packageRoot, directory), resolve(installed, directory), { recursive: true });
    for (const file of readdirSync(resolve(installed, directory))) files[`${directory}/${file}`] = digest(readFileSync(resolve(installed, directory, file)));
  }
  writeFileSync(resolve(installed, 'package.json'), '{"type":"module"}');
  const release = { schemaVersion: 1, revision: '1'.repeat(40), artifactSha256: '2'.repeat(64), policySha256: files['policy/attribution-v1.json'], files };
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
  assert.ok(contributionTemplate.includes(policyRule)); assert.ok(agentTemplate.includes(policyRule));
  const caller = callerTemplate('a'.repeat(40)); assert.ok(caller.includes('merge_group:')); assert.ok(caller.includes('  push:'));
  assert.ok(!/paths:|paths-ignore:|if:|workflow_dispatch:|secrets:/.test(caller));
  assert.throws(() => callerTemplate('main'));
});
