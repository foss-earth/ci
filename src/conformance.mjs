import { readFileSync, realpathSync, lstatSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { digest } from './policy.mjs';
import { readJson } from './audit.mjs';
import { matrix, human, fixtureRoot, createRepo, commit, setRef, writeScope } from './fixtures.mjs';
import { callerTemplate, consumerConfig } from './templates.mjs';

export function verifyReleaseIntegrity(installedRoot, release, additional = []) {
  if (release?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(release.revision) || !/^[a-f0-9]{64}$/.test(release.artifactSha256) || !/^[a-f0-9]{64}$/.test(release.policySha256) || !release.files || typeof release.files !== 'object' || Array.isArray(release.files)) throw new Error('Invalid trusted release descriptor');
  const requested = resolve(installedRoot);
  if (!lstatSync(requested).isDirectory()) throw new Error('Installed common component must be an artifact directory, not a neighboring source symlink');
  const installed = realpathSync(requested);
  const fullSeal = existsSync(resolve(installed, 'src/release.mjs')) || release.executableSealVersion === 2;
  if (fullSeal && release.executableSealVersion !== 2 || release.executableSealVersion !== undefined && ![1, 2].includes(release.executableSealVersion)) throw new Error('Current common component requires complete executable seal version2');
  for (const dir of ['src', 'bin', 'policy', 'fixtures', ...(fullSeal ? ['scripts'] : [])]) for (const name of readdirSync(resolve(installed, dir))) if (/\.(mjs|json)$/.test(name) && !/^[a-f0-9]{64}$/.test(release.files[`${dir}/${name}`] ?? '')) throw new Error('Trusted release omits an installed executable/policy/fixture file');
  if (fullSeal && !/^[a-f0-9]{64}$/.test(release.files['package.json'] ?? '')) throw new Error('Trusted release omits package.json executable entry contracts');
  for (const path of ['bin/attribution.mjs', 'src/audit.mjs', 'src/git.mjs', 'src/policy.mjs', 'fixtures/matrix-v1.json', 'policy/attribution-v1.json', ...additional]) if (!/^[a-f0-9]{64}$/.test(release.files[path] ?? '')) throw new Error('Trusted release omits a required common component file');
  for (const [path, expected] of Object.entries(release.files)) {
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\') || path.startsWith('/') || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid release file path or digest');
    const target = resolve(installed, path), relation = relative(installed, realpathSync(target));
    if (relation.startsWith('..') || !lstatSync(target).isFile()) throw new Error('Installed common component path is not a contained regular file');
    if (digest(readFileSync(target)) !== expected) throw new Error(`Installed common component integrity mismatch: ${path}`);
  }
  if (digest(readFileSync(resolve(installed, 'policy/attribution-v1.json'))) !== release.policySha256) throw new Error('Canonical policy digest mismatch');
  return installed;
}

export function conformance({ consumer, release, outputRoot }) {
  const result = { schemaVersion: 1, commandVersion: 1, consumer: readJson(resolve(consumer, 'package.json')).name, complete: false, clean: false, tests: [], errors: [], requiredCheck: 'attribution / Attribution policy' };
  try {
    const config = readJson(resolve(consumer, '.attribution.json'));
    if (!isDeepStrictEqual(config, consumerConfig(release))) throw new Error('Consumer policy, installed entry point or trusted immutable pin mismatch');
    if (readFileSync(resolve(consumer, config.workflow), 'utf8') !== callerTemplate(release.revision)) throw new Error('Caller differs from unconditional canonical caller: no skips, bypasses or mutable pins permitted');
    verifyReleaseIntegrity(resolve(consumer, 'node_modules/@foss-earth/ci'), release);
    result.pin = { revision: release.revision, artifactSha256: release.artifactSha256, policySha256: release.policySha256 };
    const root = fixtureRoot(consumer, outputRoot);
    const cases = [{ id: 'human', expected: 0 }];
    for (const ai of matrix.ai) for (const field of ['author', 'committer', 'coauthor']) cases.push({ id: `${ai.name}-${field}`, ai, field, expected: 1 });
    for (const [index, fixture] of cases.entries()) {
      const repo = createRepo(root, `fixture-${index}`);
      const id = commit(repo, { author: fixture.field === 'author' ? fixture.ai : human, committer: fixture.field === 'committer' ? fixture.ai : human, message: fixture.field === 'coauthor' ? `Synthetic contribution\n\nCo-authored-by: ${fixture.ai.name} <${fixture.ai.email}>` : 'Synthetic contribution' });
      setRef(repo, id);
      const run = spawnSync(process.execPath, [resolve(consumer, config.entryPoint[1]), '--repo', repo, '--refs-file', writeScope(repo)], { cwd: consumer, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      let response;
      try { response = JSON.parse(run.stdout); } catch { throw new Error('Installed entry point did not return its JSON contract'); }
      const pass = run.status === fixture.expected && response.exitCode === fixture.expected && response.complete === true && response.clean === (fixture.expected === 0) && (fixture.expected === 0 || response.violations.some(v => v.rule === 'attribution.ai-identity'));
      result.tests.push({ id: fixture.id, expectedExitCode: fixture.expected, actualExitCode: run.status, pass });
    }
    result.complete = true;
    result.clean = result.tests.every(t => t.pass);
  } catch (error) { result.errors.push(error.message); }
  result.exitCode = !result.complete ? 2 : result.clean ? 0 : 1;
  return result;
}
