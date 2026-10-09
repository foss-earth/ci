import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit, parseCommit } from '../src/audit.mjs';
import { loadPolicy, parseIdentity, identityRule, trailers } from '../src/policy.mjs';
import { git } from '../src/git.mjs';
import { packageRoot, fixtureRoot, createRepo, commit, setRef, publication, matrix, human } from '../src/fixtures.mjs';

const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/regression'));
let serial = 0;
const repo = () => createRepo(root, `repo-${serial++}`);
const run = (r, config) => audit({ repo: r, mode: 'publication', publication: publication(r), config });

test('allowed humans, similar product names, roots and non-AI automation', () => {
  for (const identity of [...matrix.humans, matrix.automation]) {
    const r = repo(); setRef(r, commit(r, { author: identity, committer: identity }));
    assert.equal(run(r).exitCode, 0);
  }
});
for (const ai of matrix.ai) for (const field of ['author', 'committer', 'coauthor']) test(`${ai.name}: independent ${field} denial`, () => {
  const r = repo();
  setRef(r, commit(r, { author: field === 'author' ? ai : human, committer: field === 'committer' ? ai : human, message: field === 'coauthor' ? `Change\n\nCo-authored-by: ${ai.name} <${ai.email}>` : 'Change' }));
  const result = run(r);
  assert.equal(result.exitCode, 1); assert.equal(result.complete, true);
  assert.equal(result.violations[0].field, field === 'coauthor' ? 'trailer.coauthoredby' : field);
});
test('exact matching, known email aliases, mixed case and whitespace, multiple/folded trailers', () => {
  const r = repo(); setRef(r, commit(r, { author: { name: '  cLaUdE   CoDe  ', email: 'someone@example.invalid' }, message: 'Change\n\nReviewed-by: Sample Contributor <contributor@example.invalid>\ncO-AuThOrEd-By :  CuRsOr   AgEnT <cursor@example.invalid>\nCo-authored-by: OpenAI\n Codex <codex@example.invalid>' }));
  const result = run(r); assert.equal(result.exitCode, 1); assert.equal(result.violations.length, 3);
  assert.equal(identityRule(parseIdentity('Sample Contributor <CLAUDE@ANTHROPIC.COM>'), loadPolicy()), 'attribution.ai-identity');
});
test('allowed ordinary prose, quotations and fenced examples', () => {
  for (const message of ['Discuss Claude, Cursor and Codex in documentation.', 'Change\n\n> Co-authored-by: Claude <claude@example.invalid>', 'Example\n\n```text\nCo-authored-by: Codex <codex@example.invalid>\n```', 'The phrase Co-authored-by: Cursor is an example in ordinary prose.']) {
    const r = repo(); setRef(r, commit(r, { message })); assert.equal(run(r).exitCode, 0);
  }
});
test('unrelated prose cannot neutralize a real terminal identity trailer', () => {
  const r = repo(); setRef(r, commit(r, { message: 'Change\n\nCo-authored-by: Claude <claude@example.invalid>\nUnrelated text' })); assert.equal(run(r).exitCode, 1);
});
test('strict identity mode, auditable automation, no override and duplicate aliases', () => {
  const r = repo(); setRef(r, commit(r, { committer: matrix.automation }));
  const config = { mode: 'approved', approvedIdentities: [{ ...human, kind: 'human', review: 'synthetic approval' }, matrix.automation] };
  assert.equal(run(r, config).exitCode, 0); assert.equal(run(r, { mode: 'approved' }).exitCode, 1);
  assert.equal(run(r, { forbiddenNames: [] }).exitCode, 2);
  assert.equal(run(r, { extraForbiddenNames: ['Something', '  something '] }).exitCode, 2);
  assert.equal(run(r, { extraForbiddenNames: ['CLAUDE'] }).exitCode, 2);
  assert.equal(run(r, { approvedIdentities: [config.approvedIdentities[0], config.approvedIdentities[0]] }).exitCode, 2);
  assert.equal(identityRule(parseIdentity('Claude <claude@example.invalid>'), loadPolicy({ mode: 'approved', approvedIdentities: [{ name: 'Claude', email: 'claude@example.invalid', kind: 'human', review: 'attempted bypass' }] })), 'attribution.ai-identity');
});
test('mailmap cannot mask recorded authorship', () => {
  const r = repo(); setRef(r, commit(r, { author: matrix.ai[0] }));
  writeFileSync(resolve(r, '.mailmap'), 'Sample Contributor <contributor@example.invalid> Claude <claude@example.invalid>\n');
  assert.equal(run(r).exitCode, 1);
});
test('merge ancestry, nondefault branch and annotated/nonannotated tags', () => {
  const r = repo(), clean = commit(r), bad = commit(r, { author: matrix.ai[0], parents: [clean] }), good = commit(r, { parents: [clean] });
  const merge = commit(r, { parents: [good, bad] }); setRef(r, merge);
  assert.equal(run(r).exitCode, 1);
  setRef(r, good); setRef(r, bad, 'refs/heads/other'); setRef(r, bad, 'refs/tags/forbidden');
  const tag = git(r, ['hash-object', '-w', '-t', 'tag', '--stdin'], `object ${bad}\ntype commit\ntag annotated\ntagger Sample Contributor <contributor@example.invalid> 1700000000 +0000\n\nSynthetic tag\n`);
  setRef(r, tag, 'refs/tags/annotated');
  const result = audit({ repo: r, mode: 'publication', publication: publication(r, ['refs/heads/main', 'refs/heads/other', 'refs/tags/forbidden', 'refs/tags/annotated']) });
  assert.equal(result.exitCode, 1); assert.equal(result.scope.commitCount, 3); assert.equal(result.scope.selectedRefs.at(-1).commit, bad);
  assert.equal(run(r).exitCode, 0); // Explicitly selected main only is described as such, never called all-publication.
});
test('replacement and graft ancestry overlays fail, and replacement environment cannot hide an ancestor', () => {
  const r = repo(), bad = commit(r, { author: matrix.ai[0] }), clean = commit(r); setRef(r, bad);
  git(r, ['update-ref', `refs/replace/${bad}`, clean]); assert.equal(run(r).errors[0].rule, 'history.replacements');
  git(r, ['update-ref', '-d', `refs/replace/${bad}`]);
  writeFileSync(resolve(r, '.git/info/grafts'), `${bad}\n`); assert.equal(run(r).errors[0].rule, 'history.grafts');
  writeFileSync(resolve(r, '.git/info/grafts'), '');
  process.env.GIT_REPLACE_REF_BASE = 'refs/hide/'; process.env.GIT_SHALLOW_FILE = '/dev/null';
  assert.equal(run(r).exitCode, 1); delete process.env.GIT_REPLACE_REF_BASE; delete process.env.GIT_SHALLOW_FILE;
});
test('shallow, missing parent/ref, malformed metadata and invalid source fail incomplete', () => {
  const r = repo(), first = commit(r); setRef(r, first);
  writeFileSync(resolve(r, '.git/shallow'), `${first}\n`); assert.equal(run(r).exitCode, 2);
  writeFileSync(resolve(r, '.git/shallow'), '');
  const missing = 'a'.repeat(40); setRef(r, commit(r, { parents: [missing] })); assert.equal(run(r).exitCode, 2);
  setRef(r, first); const p = publication(r); p.refs.push({ name: 'refs/heads/missing', oid: first }); assert.equal(audit({ repo: r, mode: 'publication', publication: p }).exitCode, 2);
  const mismatch = publication(r); mismatch.refs[0].oid = missing; assert.equal(audit({ repo: r, mode: 'publication', publication: mismatch }).exitCode, 2);
  const unsafe = publication(r); unsafe.source.location = 'ext::anything'; assert.equal(audit({ repo: r, mode: 'publication', publication: unsafe }).exitCode, 2);
  assert.throws(() => parseCommit('tree a\nauthor Claude <c@example.invalid> 1 +0000\n\nBad'));
  const malformed = commit(r, { rawHeaders: `tree ${git(r, ['hash-object', '-w', '-t', 'tree', '--stdin'], Buffer.alloc(0))}\nauthor malformed\ncommitter Sample Contributor <c@example.invalid> 1 +0000` }); setRef(r, malformed); assert.equal(run(r).exitCode, 2);
});
test('clean extraction and later violation are independently audited, no stale success cache', () => {
  const r = repo(), clean = commit(r); setRef(r, clean); assert.equal(run(r).exitCode, 0);
  const oldScope = publication(r); setRef(r, commit(r, { parents: [clean], message: 'Change\n\nCo-authored-by: Codex <codex@example.invalid>' }));
  assert.equal(run(r).exitCode, 1); assert.equal(audit({ repo: r, mode: 'publication', publication: oldScope }).exitCode, 2);
});
test('proposed range is explicit and excludes only reachable base ancestry', () => {
  const r = repo(), base = commit(r), other = commit(r, { message: 'Independent root' }), head = commit(r, { parents: [base], committer: matrix.ai[0] });
  assert.equal(audit({ repo: r, mode: 'range', base, head }).exitCode, 1);
  assert.equal(audit({ repo: r, mode: 'range', base: other, head }).exitCode, 2);
  assert.equal(audit({ repo: r, mode: 'range', base, head: base }).scope.commitCount, 0);
});
test('fixture safety rejects real repository, escape and missing ignored build ownership', () => {
  assert.throws(() => fixtureRoot(packageRoot, packageRoot));
  assert.throws(() => fixtureRoot(packageRoot, resolve(packageRoot, '../outside/build')));
});
