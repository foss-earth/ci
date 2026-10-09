import { AuditError, git } from './git.mjs';
import { digest } from './policy.mjs';

// Immutable dependency bytes travel in the protected baseline tree. The source
// release precedes the self-adoption commit containing its archive, so no archive
// embeds itself and no platform/runtime recompression is needed for validation.
export function releaseArtifactPath(release) {
  if (!/^[a-f0-9]{40}$/.test(release?.revision ?? '')) throw new AuditError('hosted.artifact-location', 'Reviewed source revision is required for the dependency artifact path');
  const expected = `deps/foss-earth-ci-${release.revision}.tgz`;
  if (release.artifactPath !== expected) throw new AuditError('hosted.artifact-location', 'Protected baseline must contain the reviewed dependency artifact at its canonical source-bound path');
  return expected;
}

export function readReleaseArtifact(repo, baseline, release, onStage = () => {}) {
  onStage('read-trusted-artifact'); const path = releaseArtifactPath(release);
  const entry = git(repo, ['ls-tree', '--full-tree', baseline, '--', path]);
  const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
  if (!match || match[2] !== path) throw new AuditError('hosted.artifact-location', 'Protected dependency artifact must be a regular Git blob');
  const size = Number(git(repo, ['cat-file', '-s', match[1]]));
  onStage('verify-trusted-artifact');
  if (!Number.isSafeInteger(release.sizeBytes) || release.sizeBytes < 1 || size !== release.sizeBytes) throw new AuditError('hosted.artifact-digest', 'Trusted artifact size does not match protected baseline descriptor');
  onStage('read-trusted-artifact'); const archive = git(repo, ['cat-file', 'blob', match[1]], undefined, true);
  onStage('verify-trusted-artifact');
  if (digest(archive) !== release.artifactSha256 || archive.length !== release.sizeBytes) throw new AuditError('hosted.artifact-digest', 'Trusted artifact digest/size does not match protected baseline descriptor');
  return archive;
}

export function verifySourceRelease(toolRoot, release) {
  const paths = git(toolRoot, ['ls-tree', '-r', '--name-only', release.revision]).split('\n');
  const fullSeal = paths.includes('src/release.mjs') || release.executableSealVersion === 2;
  if (fullSeal && release.executableSealVersion !== 2) throw new AuditError('hosted.trusted-source', 'Current source requires complete executable seal version2');
  const expected = paths.filter(path => /^(bin|src|policy|fixtures)\//.test(path) || fullSeal && (path === 'package.json' || /^scripts\//.test(path))).sort();
  if (!release.files || typeof release.files !== 'object' || Array.isArray(release.files) || JSON.stringify(Object.keys(release.files).sort()) !== JSON.stringify(expected)) throw new AuditError('hosted.trusted-source', 'Release executable inventory differs from pinned source');
  for (const path of expected) {
    const entry = git(toolRoot, ['ls-tree', release.revision, '--', path]);
    if (!/^100(?:644|755) blob /.test(entry) || digest(git(toolRoot, ['show', `${release.revision}:${path}`], undefined, true)) !== release.files[path]) throw new AuditError('hosted.trusted-source', 'Release executable bytes differ from pinned source');
  }
  if (release.files['policy/attribution-v1.json'] !== release.policySha256) throw new AuditError('hosted.trusted-source', 'Release policy digest differs from pinned source');
}
