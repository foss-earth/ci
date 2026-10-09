import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, lstatSync, openSync, closeSync, constants } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readJson } from '../src/audit.mjs';
import { callerTemplate, consumerConfig } from '../src/templates.mjs';
import { digest } from '../src/policy.mjs';
import { verifyReleaseIntegrity } from '../src/conformance.mjs';
const [descriptor, artifact, mode] = process.argv.slice(2);
if (!descriptor || !artifact || mode !== undefined && mode !== '--reviewed-update') throw new Error('Use RELEASE.json ARTIFACT.tgz [--reviewed-update] in the assigned common checkout');
const release = readJson(descriptor);
const root = process.cwd();
const paths = ['.attribution-release.json', '.attribution.json', '.github/workflows/attribution-check.yml'];
function ownedPath(path) {
  const target = resolve(root, path), rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Self-adoption path must remain inside the assigned checkout');
  let current = root;
  for (const [index, part] of rel.split(sep).entries()) {
    current = resolve(current, part);
    let stat; try { stat = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || index < rel.split(sep).length - 1 && !stat.isDirectory()) throw new Error('Self-adoption refuses symlinked targets or parent directories');
  }
  return target;
}
function ownedDirectory(path) { const target = ownedPath(path); mkdirSync(target, { recursive: true }); ownedPath(path); return target; }
function writeAdoption(path, bytes) {
  const target = ownedPath(path);
  if (existsSync(target) && !lstatSync(target).isFile()) throw new Error('Self-adoption target must be a regular file');
  const flags = constants.O_WRONLY | constants.O_CREAT | (mode === '--reviewed-update' ? constants.O_TRUNC : constants.O_EXCL) | (constants.O_NOFOLLOW ?? 0);
  const handle = openSync(target, flags, 0o644); try { writeFileSync(handle, bytes); } finally { closeSync(handle); }
}
for (const path of [...paths, 'node_modules/@foss-earth/ci', 'build/npm-cache', 'build/tmp', 'build/bootstrap-updates']) ownedPath(path);
if (digest(readFileSync(artifact)) !== release.artifactSha256) throw new Error('Reviewed artifact digest mismatch before installation');
if (mode !== '--reviewed-update' && paths.some(path => existsSync(path))) throw new Error('Existing self-adoption needs the separately reviewed update path');
if (mode === '--reviewed-update') {
  const backup = ownedDirectory(`build/bootstrap-updates/${randomUUID()}`);
  for (const [index, path] of paths.entries()) if (existsSync(ownedPath(path))) { if (!lstatSync(ownedPath(path)).isFile()) throw new Error('Self-adoption backup requires a regular file'); copyFileSync(ownedPath(path), resolve(backup, `${index}.previous`), constants.COPYFILE_EXCL); }
}
for (const path of ['build/npm-cache', 'build/tmp', '.github/workflows']) ownedDirectory(path);
const run = spawnSync('npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', resolve(artifact)], { stdio: 'inherit', env: { ...process.env, npm_config_cache: resolve(root, 'build/npm-cache'), TMPDIR: resolve(root, 'build/tmp') } });
if (run.status !== 0) process.exit(run.status ?? 2);
verifyReleaseIntegrity(resolve(root, 'node_modules/@foss-earth/ci'), release);
writeAdoption('.attribution-release.json', `${JSON.stringify(release, null, 2)}\n`);
writeAdoption('.attribution.json', `${JSON.stringify(consumerConfig(release), null, 2)}\n`);
writeAdoption('.github/workflows/attribution-check.yml', callerTemplate(release.revision));
