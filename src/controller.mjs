import { isDeepStrictEqual } from 'node:util';
import { audit } from './audit.mjs';
import { prepareCandidate } from './candidate.mjs';
import { git, oid, refName, AuditError } from './git.mjs';
import { callerTemplate, consumerConfig } from './templates.mjs';
import { loadPolicy, digest } from './policy.mjs';
import { verifyReleaseIntegrity } from './conformance.mjs';
import { fileURLToPath } from 'node:url';

export class GitLeaseTransport {
  constructor({ repo, source }) {
    if (typeof source !== 'string' || !source || source.startsWith('-') || /[\r\n\0]/.test(source) || /^[a-z][a-z0-9+.-]*:/i.test(source) && !/^(https|ssh|file):\/\//.test(source)) throw new AuditError('admission.source', 'Unreviewed Git helper/source protocol');
    if (source.startsWith('https://')) { const url = new URL(source); if (url.username || url.password || url.search || url.hash) throw new AuditError('admission.source', 'Source binding cannot contain credentials or query/fragment tokens'); }
    this.repo = repo; this.source = source;
  }
  advertised() {
    return new Map(git(this.repo, ['ls-remote', '--heads', '--tags', '--refs', '--', this.source]).split('\n').filter(Boolean).map(line => { const [id, name] = line.split('\t'); return [refName(name), oid(id)]; }));
  }
  publish(id, ref, expectedOld) {
    oid(id); refName(ref); if (!ref.startsWith('refs/heads/')) throw new AuditError('admission.tag-route', 'Tag publication needs its separate reviewed admission path');
    if (expectedOld !== '') oid(expectedOld);
    // Receive-pack performs the expected-old comparison atomically. No REST force update.
    git(this.repo, ['push', '--porcelain', '--signed=false', '--no-follow-tags', '--recurse-submodules=no', `--force-with-lease=${ref}:${expectedOld}`, '--', this.source, `${id}:${ref}`]);
    return { ref, oid: id, expectedOld, mechanism: 'Git protocol explicit force-with-lease' };
  }
}
export function prepareAdmission({ repo, target, proposalRef, expectedHead, metadata, method, config }) {
  const binding = config?.targets?.[target];
  if (config?.schemaVersion !== 1 || !binding || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target)) throw new AuditError('admission.target', 'Target is not in the separately trusted exact allowlist');
  refName(binding.protectedRef);
  if (!binding.protectedRef.startsWith('refs/heads/') || !Array.isArray(binding.publicationRefs) || !binding.publicationRefs.includes(binding.protectedRef) || !binding.allowedMethods?.includes(method)) throw new AuditError('admission.binding', 'Protected branch/publication scope/merge method is not explicitly bound');
  if (!/^(refs\/heads\/[^\s]+|refs\/pull\/\d+\/head)$/.test(proposalRef) || /[\0~^:?*\[\\]|\.\.|@\{/.test(proposalRef)) throw new AuditError('admission.proposal-ref', 'Invalid explicit proposed source ref');
  oid(expectedHead);
  const transport = new GitLeaseTransport({ repo, source: binding.source });
  const advertised = transport.advertised();
  // Every currently advertised branch/tag must have an explicit publication decision.
  if ([...advertised.keys()].some(name => !binding.publicationRefs.includes(name)) || binding.publicationRefs.some(name => !advertised.has(name))) throw new AuditError('admission.publication-scope', 'Advertised publication refs differ from the complete explicit allowlist');
  const proposalAdvertisement = git(repo, ['ls-remote', '--refs', '--', binding.source, proposalRef]).split('\n').filter(Boolean);
  if (proposalAdvertisement.length !== 1 || proposalAdvertisement[0].split('\t')[0] !== expectedHead) throw new AuditError('admission.head-race', 'Proposed head changed or source proof is missing');
  const base = advertised.get(binding.protectedRef), head = expectedHead;
  const release = config.ciRelease;
  if (!release || release.policySha256 !== loadPolicy().sha256) throw new AuditError('admission.policy-pin', 'Installed controller policy differs from trusted common release');
  verifyReleaseIntegrity(fileURLToPath(new URL('..', import.meta.url)), release, ['src/controller.mjs', 'src/github-checks.mjs', 'src/candidate.mjs', 'src/conformance.mjs']);
  const baseline = JSON.parse(git(repo, ['show', `${base}:.attribution-release.json`]));
  const proposedRelease = JSON.parse(git(repo, ['show', `${head}:.attribution-release.json`]));
  const proposedConfig = JSON.parse(git(repo, ['show', `${head}:.attribution.json`]));
  const caller = git(repo, ['show', `${head}:.github/workflows/attribution-check.yml`], undefined, true).toString('utf8');
  const baselineConfig = JSON.parse(git(repo, ['show', `${base}:.attribution.json`]));
  const baselineCaller = git(repo, ['show', `${base}:.github/workflows/attribution-check.yml`], undefined, true).toString('utf8');
  if (!isDeepStrictEqual(baseline, release) || !isDeepStrictEqual(proposedRelease, release) || !isDeepStrictEqual(baselineConfig, consumerConfig(release)) || !isDeepStrictEqual(proposedConfig, consumerConfig(release)) || baselineCaller !== callerTemplate(release.revision) || caller !== baselineCaller) throw new AuditError('admission.trusted-baseline', 'Caller/config/release pin replacement requires the separate trusted update path');
  const publication = { schemaVersion: 1, source: { id: target, location: binding.source }, refs: binding.publicationRefs.map(name => ({ name, oid: advertised.get(name) })) };
  const prior = audit({ repo, mode: 'publication', publication, config: config.policy });
  if (prior.exitCode !== 0) return { ready: false, admission: false, exitCode: prior.exitCode, prior };
  const tree = oid(git(repo, ['merge-tree', '--write-tree', base, head]).split('\n')[0]);
  const candidate = prepareCandidate({ repo, base, head, tree, method, metadata, config: config.policy });
  return { ...candidate, target, proposalRef, prior, ciRevision: release.revision, policySha256: release.policySha256, stageRef: candidate.candidate ? `refs/heads/admission/${candidate.candidate}` : undefined };
}
export async function controlledAdmission({ input, phase, candidate, readTrustedChecks, publishGuarded, publish = false }) {
  // Controller process/config/check gateway are trusted service inputs, never PR code.
  const prepared = prepareAdmission(input);
  if (!prepared.ready) return prepared;
  const binding = input.config.targets[input.target], transport = new GitLeaseTransport({ repo: input.repo, source: binding.source });
  if (phase === 'stage') {
    if (!publish) return { ...prepared, stagePublished: false, next: 'Coordinator binds service credentials/permissions and authorizes clean staging publication' };
    const existing = transport.advertised().get(prepared.stageRef);
    if (existing && existing !== prepared.candidate) throw new AuditError('admission.stage-conflict', 'Staging ref conflicts; no overwrite');
    const receipt = existing ? { ref: prepared.stageRef, oid: existing, reused: true } : transport.publish(prepared.candidate, prepared.stageRef, '');
    return { ...prepared, stagePublished: true, stageReceipt: receipt, publicationRefsAfterStage: [...new Set([...binding.publicationRefs, prepared.stageRef])], admission: false };
  }
  if (phase !== 'admit' || candidate !== prepared.candidate || typeof readTrustedChecks !== 'function') throw new AuditError('admission.candidate-binding', 'Admission needs the unchanged exact candidate and trusted check gateway');
  const expected = binding.ownerChecks;
  if (!Array.isArray(expected) || !expected.some(check => check.purpose === 'consumer-conformance') || expected.some(check => !['domain', 'consumer-conformance'].includes(check.purpose) || !check.name || !Number.isSafeInteger(check.appId) || check.appId < 1 || !check.workflowPath || !/^[a-f0-9]{40}$/.test(check.workflowSha))) throw new AuditError('admission.check-binding', 'Actual owner-check name/App/workflow pins and mandatory installed common conformance check are unbound');
  const checks = await readTrustedChecks({ target: input.target, candidate: prepared.candidate, tree: prepared.tree });
  const verifiedChecks = [];
  for (const required of expected) {
    const rows = checks.filter(check => check.name === required.name && check.appId === required.appId && check.headSha === prepared.candidate && check.workflowPath === required.workflowPath && check.workflowSha === required.workflowSha);
    if (rows.length !== 1 || rows[0].status !== 'completed' || rows[0].conclusion !== 'success' || rows[0].trustedJobProof !== true) throw new AuditError('admission.owner-check', 'Exact candidate owner checks missing, ambiguous, stale, skipped, failed or without trusted job proof');
    if (required.purpose === 'consumer-conformance' && (rows[0].conformanceVerified !== true || !isDeepStrictEqual(rows[0].conformancePin, { revision: input.config.ciRelease.revision, artifactSha256: input.config.ciRelease.artifactSha256, policySha256: input.config.ciRelease.policySha256 }))) throw new AuditError('admission.consumer-conformance', 'Trusted installed-entry-point conformance evidence for the exact candidate/common release is missing');
    verifiedChecks.push({ ...required, headSha: rows[0].headSha, status: rows[0].status, conclusion: rows[0].conclusion, trustedJobProof: true, ...(required.purpose === 'consumer-conformance' ? { conformanceVerified: true, conformancePin: rows[0].conformancePin } : {}) });
  }
  // Re-read after checks: base/head/source drift invalidates the staged candidate.
  const fresh = prepareAdmission(input);
  if (!fresh.ready || fresh.candidate !== prepared.candidate || !isDeepStrictEqual(fresh.prior.scope.selectedRefs, prepared.prior.scope.selectedRefs)) throw new AuditError('admission.base-race', 'Protected base, proposal or publication snapshot changed while checks ran; restage/recheck');
  if (!publish) return { ...fresh, checksVerified: true, admission: false, next: 'Reviewable exact candidate; publication remains coordinator-only' };
  const guard = binding.admissionGuard;
  if (typeof publishGuarded !== 'function' || typeof binding.sourceBindingId !== 'string' || !binding.sourceBindingId || typeof guard?.id !== 'string' || !guard.id || typeof guard.version !== 'string' || !guard.version) throw new AuditError('admission.snapshot-guard', 'Publication requires a separately bound transaction/freeze service; a protected-base Git lease alone cannot exclude proposal or publication-scope drift');
  const publicationSnapshot = fresh.prior.scope.selectedRefs.map(ref => ({ ref: ref.name, oid: ref.oid })).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  const request = { target: input.target, sourceBindingId: binding.sourceBindingId, protectedRef: binding.protectedRef, candidate: fresh.candidate, expectedBase: fresh.protectedBase, proposal: { ref: input.proposalRef, expectedHead: input.expectedHead }, publicationSnapshot, publicationSnapshotSha256: digest(JSON.stringify(publicationSnapshot)), checkWitnessDigest: digest(JSON.stringify(verifiedChecks)), ciPin: { revision: input.config.ciRelease.revision, artifactSha256: input.config.ciRelease.artifactSha256, policySha256: input.config.ciRelease.policySha256 }, guard };
  // This service OWNS the write. It must exclude every independent source/ref
  // writer while validating the snapshot through receive-pack acceptance. No
  // client pre-read, process mutex or later unguarded push substitutes for it.
  const receipt = await publishGuarded(request);
  const expectedReceipt = { target: request.target, ref: request.protectedRef, old: request.expectedBase, new: request.candidate, proposalHead: request.proposal.expectedHead, publicationSnapshotSha256: request.publicationSnapshotSha256, checkWitnessDigest: request.checkWitnessDigest, ciPin: request.ciPin, guard: request.guard };
  if (receipt?.accepted !== true || typeof receipt.transactionId !== 'string' || !receipt.transactionId || !isDeepStrictEqual(Object.fromEntries(Object.keys(expectedReceipt).map(key => [key, receipt?.[key]])), expectedReceipt)) throw new AuditError('admission.snapshot-receipt', 'Guarded publication did not return the exact bound transaction receipt; admission is unverified');
  return { ...fresh, admission: true, checksVerified: true, publicationReceipt: receipt };
}
