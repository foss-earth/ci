import { audit } from './audit.mjs';
import { git, oid, repositorySafety } from './git.mjs';
import { parseIdentity } from './policy.mjs';

// Constructs objects only. It never moves a branch, pushes, or claims admission.
export function prepareCandidate({ repo, base, head, tree, method, metadata, config }) {
  repositorySafety(repo); oid(base); oid(head); oid(tree);
  if (!['merge', 'squash'].includes(method)) throw new Error('Only controlled merge and squash are implemented; disable unproved methods');
  const common = oid(git(repo, ['merge-base', base, head]));
  const proposal = audit({ repo, mode: 'range', base: common, head, config });
  if (proposal.exitCode !== 0) return { schemaVersion: 1, ready: false, admission: false, proposal, exitCode: proposal.exitCode };
  if (git(repo, ['cat-file', '-t', tree]) !== 'tree') throw new Error('Candidate tree is not a tree object');
  if (typeof metadata?.author !== 'string' || typeof metadata.committer !== 'string' || typeof metadata.message !== 'string' || /[\0\r]/.test(metadata.message)) throw new Error('Explicit final author, committer and message required');
  parseIdentity(metadata.author, true); parseIdentity(metadata.committer, true);
  const parents = method === 'merge' ? [base, head] : [base];
  const raw = [`tree ${tree}`, ...parents.map(id => `parent ${id}`), `author ${metadata.author}`, `committer ${metadata.committer}`, '', metadata.message, ''].join('\n');
  const candidate = oid(git(repo, ['hash-object', '-w', '-t', 'commit', '--stdin'], raw));
  const final = audit({ repo, mode: 'range', base, head: candidate, config });
  return { schemaVersion: 1, ready: final.exitCode === 0, admission: false, protectedBase: base, proposedHead: head, candidate, tree, method, proposal, final, exitCode: final.exitCode, next: 'Coordinator must verify candidate tree/integration checks and compare-and-swap only this exact candidate onto the protected ref; direct/UI edits and other bypass paths remain disabled' };
}
