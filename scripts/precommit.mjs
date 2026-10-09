import { spawnSync } from 'node:child_process';
import { loadPolicy, parseIdentity, identityRule } from '../src/policy.mjs';
for (const field of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
  const run = spawnSync('git', ['var', field], { encoding: 'utf8' });
  if (run.status !== 0 || identityRule(parseIdentity(run.stdout.trim(), true), loadPolicy())) throw new Error('Configured commit attribution is not permitted');
}
process.stdout.write('Configured author and committer satisfy the reviewed known-identity policy. No personal data printed.\n');
