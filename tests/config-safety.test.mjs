import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureRoot, packageRoot, createRepo, commit, setRef, publication } from '../src/fixtures.mjs';
import { audit } from '../src/audit.mjs';
import { git } from '../src/git.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/config-safety'));
for (const kind of ['rewrite-ssh', 'credential', 'merge-driver', 'filter', 'gpg', 'include', 'worktree']) test(`subject ${kind} configuration cannot execute or mask source`, () => {
  const repo = createRepo(root, kind), head = commit(repo); setRef(repo, head);
  const scope = publication(repo), sentinel = resolve(repo, 'executed.txt'), program = resolve(repo, 'never-execute.mjs');
  writeFileSync(program, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unsafe subject command ran');\n`);
  const settings = {
    'rewrite-ssh': `[url "ssh://example.invalid/source"]\n insteadOf = https://example.invalid/source\n[core]\n sshCommand = node ${program}\n`,
    credential: `[credential]\n helper = !node ${program}\n`,
    'merge-driver': `[merge "subject"]\n driver = node ${program}\n`,
    filter: `[filter "subject"]\n clean = node ${program}\n`,
    gpg: `[gpg]\n program = node ${program}\n`,
    include: '[include]\n path = subject-configuration\n'
  };
  if (kind === 'worktree') { appendFileSync(resolve(repo, '.git/config'), '[extensions]\n worktreeConfig = true\n'); writeFileSync(resolve(repo, '.git/config.worktree'), settings['rewrite-ssh']); }
  else appendFileSync(resolve(repo, '.git/config'), settings[kind]);
  if (kind === 'rewrite-ssh') scope.source.location = 'https://example.invalid/source';
  const result = audit({ repo, mode: 'publication', publication: scope });
  assert.equal(result.exitCode, 2); assert.equal(result.errors[0].rule, 'history.unsafe-config'); assert.equal(existsSync(sentinel), false);
  assert.throws(() => git(repo, ['merge-tree', '--write-tree', head, head]), /Subject configuration/); assert.equal(existsSync(sentinel), false);
});
