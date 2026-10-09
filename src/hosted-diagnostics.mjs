import { AuditError } from './git.mjs';

const stages = new Set(['read-event', 'validate-event', 'initialize-subject', 'fetch-publication', 'fetch-event', 'resolve-range', 'audit-range', 'read-publication-refs', 'audit-publication', 'resolve-baseline', 'read-trusted-release', 'read-trusted-tool-pin', 'read-trusted-artifact', 'archive-trusted-source', 'compress-trusted-archive', 'verify-trusted-artifact', 'initialize-installed-consumer', 'read-consumer-policy', 'install-trusted-artifact', 'installed-entry-conformance', 'write-result']);
const rules = new Set(['hosted.event-identity', 'hosted.event-number', 'hosted.event-type', 'hosted.trusted-pin', 'hosted.artifact-location', 'hosted.artifact-digest', 'hosted.artifact-install', 'history.unsafe-config', 'history.config-read', 'history.git-failure', 'history.shallow', 'history.grafts', 'history.replacements', 'history.corrupt-object', 'scope.invalid-oid', 'scope.invalid-ref', 'scope.manifest', 'scope.duplicate-ref', 'scope.source-protocol', 'scope.source-credentials', 'scope.source-mismatch', 'scope.peel-mismatch', 'scope.unrelated-base', 'scope.mode', 'scope.not-commit', 'metadata.commit', 'metadata.header', 'metadata.parent-type', 'metadata.encoding', 'metadata.nul', 'metadata.tag-cycle', 'metadata.tag-target-type', 'metadata.tag', 'metadata.tag-signature', 'metadata.identity', 'metadata.timezone', 'policy.invalid', 'policy.duplicate-alias', 'policy.schema', 'policy.invalid-mode', 'policy.override', 'policy.approval', 'policy.duplicate-identity']);

stages.add('verify-trusted-source'); rules.add('hosted.trusted-source');

// Never serialize exception messages, stdout/stderr, paths, identities or env.
export function hostedFailure(error, stage) {
  const diagnostic = { rule: error instanceof AuditError && rules.has(error.rule) ? error.rule : 'hosted.failure', stage: stages.has(stage) ? stage : 'unknown', detail: 'Hosted validation failed at the recorded stage; inspect retained controlled evidence and repair before retrying' };
  if (error instanceof AuditError && Number.isInteger(error.status) && error.status >= 0 && error.status <= 255) diagnostic.status = error.status;
  return { complete: false, clean: false, exitCode: 2, errors: [diagnostic] };
}
