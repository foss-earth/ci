import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { git, oid } from './git.mjs';
import { digest } from './policy.mjs';
import { conformance } from './conformance.mjs';

export function hostedConformance({ subject, baseline, head, root, toolRoot }) {
  oid(baseline); oid(head);
  // Descriptor comes from the protected baseline, never PR replacement policy/code.
  const release = JSON.parse(git(subject, ['show', `${baseline}:.attribution-release.json`]));
  const installedRevision = oid(git(toolRoot, ['rev-parse', 'HEAD']));
  if (release.revision !== installedRevision) throw new Error('Trusted workflow/tool pin differs from protected baseline release; use separate update path');
  const archive = gzipSync(git(toolRoot, ['archive', '--format=tar', '--prefix=package/', release.revision], undefined, true), { level: 9 });
  if (digest(archive) !== release.artifactSha256) throw new Error('Trusted installed artifact digest does not match protected baseline');
  const consumer = resolve(root, 'consumer'); mkdirSync(consumer, { recursive: true });
  git(consumer, ['init', '--quiet', '--initial-branch=main']);
  mkdirSync(resolve(consumer, '.github/workflows'), { recursive: true });
  writeFileSync(resolve(consumer, '.gitignore'), '/build/\n/node_modules/\n');
  writeFileSync(resolve(consumer, 'package.json'), '{"name":"hosted-subject","private":true}');
  writeFileSync(resolve(consumer, '.attribution.json'), git(subject, ['show', `${head}:.attribution.json`]));
  writeFileSync(resolve(consumer, '.github/workflows/attribution-check.yml'), git(subject, ['show', `${head}:.github/workflows/attribution-check.yml`], undefined, true));
  const artifact = resolve(root, 'common.tgz'); writeFileSync(artifact, archive);
  const cache = resolve(root, 'npm-cache'), temp = resolve(root, 'tmp'); mkdirSync(cache, { recursive: true }); mkdirSync(temp, { recursive: true });
  const install = spawnSync('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', artifact], { encoding: 'utf8', env: { ...process.env, npm_config_cache: cache, TMPDIR: temp }, maxBuffer: 8 * 1024 * 1024 });
  if (install.status !== 0) throw new Error('Exact common artifact installation failed');
  const result = conformance({ consumer, release, outputRoot: resolve(consumer, 'build/conformance') });
  result.consumerSource = { baseline, head }; return result;
}
