import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureRoot, packageRoot } from '../src/fixtures.mjs';
import { digest } from '../src/policy.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/bootstrap-self'));
for (const kind of ['file', 'parent', 'node-modules', 'dangling']) test(`self-adoption refuses ${kind} symlink before installing or writing`, () => {
  const owner = resolve(root, kind), retained = resolve(root, `retained-${kind}`), artifact = resolve(root, `${kind}.tgz`), descriptor = resolve(root, `${kind}-release.json`);
  mkdirSync(owner); mkdirSync(retained); writeFileSync(resolve(retained, 'identity.json'), 'preserved evidence');
  const bytes = Buffer.from('synthetic artifact must never be installed'); writeFileSync(artifact, bytes); writeFileSync(descriptor, JSON.stringify({ artifactSha256: digest(bytes) }));
  if (kind === 'file') symlinkSync(resolve(retained, 'identity.json'), resolve(owner, '.attribution.json'));
  if (kind === 'dangling') symlinkSync(resolve(retained, 'missing.json'), resolve(owner, '.attribution.json'));
  if (kind === 'parent') symlinkSync(retained, resolve(owner, '.github'), 'dir');
  if (kind === 'node-modules') symlinkSync(retained, resolve(owner, 'node_modules'), 'dir');
  const result = spawnSync(process.execPath, [resolve(packageRoot, 'scripts/bootstrap-self.mjs'), descriptor, artifact, '--reviewed-update'], { cwd: owner, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /refuses symlinked/);
  assert.equal(readFileSync(resolve(retained, 'identity.json'), 'utf8'), 'preserved evidence');
  assert.equal(existsSync(resolve(owner, 'build')), false); assert.equal(existsSync(resolve(retained, 'workflows')), false);
});
for (const size of [undefined, 0, 1.5, '4', 5]) test(`self-adoption refuses incorrect declared artifact size ${String(size)} before backup or installation`, () => {
  const owner = resolve(root, `size-${String(size)}`), artifact = resolve(root, `size-${String(size)}.tgz`), descriptor = resolve(root, `size-${String(size)}-release.json`);
  mkdirSync(owner); const bytes = Buffer.from('four'); writeFileSync(artifact, bytes);
  writeFileSync(descriptor, JSON.stringify({ artifactSha256: digest(bytes), sizeBytes: size }));
  writeFileSync(resolve(owner, '.attribution.json'), 'retained prior adoption');
  const result = spawnSync(process.execPath, [resolve(packageRoot, 'scripts/bootstrap-self.mjs'), descriptor, artifact, '--reviewed-update'], { cwd: owner, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Reviewed artifact size mismatch before installation/);
  assert.equal(readFileSync(resolve(owner, '.attribution.json'), 'utf8'), 'retained prior adoption');
  assert.equal(existsSync(resolve(owner, 'build')), false); assert.equal(existsSync(resolve(owner, 'node_modules')), false);
});
for (const kind of ['parent', 'file', 'conflict']) test(`self-adoption preserves ${kind} dependency artifact conflict before backup or installation`, () => {
  const owner = resolve(root, `dependency-${kind}`), retained = resolve(root, `dependency-retained-${kind}`), artifact = resolve(root, `dependency-${kind}.tgz`), descriptor = resolve(root, `dependency-${kind}.json`);
  mkdirSync(owner); mkdirSync(retained); const bytes = Buffer.from('four'), revision = '1'.repeat(40), artifactPath = `deps/foss-earth-ci-${revision}.tgz`;
  writeFileSync(artifact, bytes); writeFileSync(descriptor, JSON.stringify({ revision, artifactPath, artifactSha256: digest(bytes), sizeBytes: bytes.length }));
  writeFileSync(resolve(retained, 'identity.json'), 'retained dependency evidence');
  if (kind === 'parent') symlinkSync(retained, resolve(owner, 'deps'), 'dir');
  else { mkdirSync(resolve(owner, 'deps')); if (kind === 'file') symlinkSync(resolve(retained, 'identity.json'), resolve(owner, artifactPath)); else writeFileSync(resolve(owner, artifactPath), 'retained conflicting bytes'); }
  const result = spawnSync(process.execPath, [resolve(packageRoot, 'scripts/bootstrap-self.mjs'), descriptor, artifact, '--reviewed-update'], { cwd: owner, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /refuses symlinked|Existing dependency artifact conflicts/);
  assert.equal(readFileSync(resolve(retained, 'identity.json'), 'utf8'), 'retained dependency evidence');
  if (kind === 'conflict') assert.equal(readFileSync(resolve(owner, artifactPath), 'utf8'), 'retained conflicting bytes');
  assert.equal(existsSync(resolve(owner, 'build')), false); assert.equal(existsSync(resolve(owner, 'node_modules')), false);
});
