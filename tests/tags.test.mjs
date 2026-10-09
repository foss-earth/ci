import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { git } from '../src/git.mjs';
import { audit } from '../src/audit.mjs';
import { fixtureRoot, packageRoot, createRepo, commit, setRef, publication } from '../src/fixtures.mjs';
const root = fixtureRoot(packageRoot, resolve(packageRoot, 'build/fixtures/tags')); let serial = 0;
function tag(repo, target, { type = 'commit', tagger = 'Legacy Human <legacy-user> 1700000000 +0000', message = 'Human release' } = {}) {
  return git(repo, ['hash-object', '-w', '-t', 'tag', '--stdin', '--literally'], `object ${target}\ntype ${type}\ntag synthetic\n${tagger === null ? '' : `tagger ${tagger}\n`}\n${message}\n`);
}
for (const kind of ['human', 'quoted-signature', 'tagger', 'coauthor', 'nested', 'signed', 'signed-crlf', 'signed-padding', 'signed-whitespace', 'fake-signature', 'post-signature', 'multiple-signature']) test(`selected annotated tag ${kind} attribution`, () => {
  const repo = createRepo(root, `tag-${serial++}`), head = commit(repo); setRef(repo, head);
  const messages = {
    coauthor: 'Release\n\nCo-authored-by: Codex <legacy-ai>',
    signed: 'Release\n\nCo-authored-by: Codex <legacy-ai>\n-----BEGIN PGP SIGNATURE-----\nc3ludGhldGlj\n-----END PGP SIGNATURE-----',
    'signed-crlf': 'Release\r\n\r\nCo-authored-by: Codex <legacy-ai>\r\n-----BEGIN PGP SIGNATURE-----\r\n\r\nc3ludGhldGlj\r\n-----END PGP SIGNATURE-----\r\n',
    'signed-padding': 'Release\n\nCo-authored-by: Codex <legacy-ai>\n-----BEGIN PGP SIGNATURE-----\n\nc3ludGhldGlj\n-----END PGP SIGNATURE-----\n\n',
    'signed-whitespace': 'Release\n\nCo-authored-by: Codex <legacy-ai>\n-----BEGIN PGP SIGNATURE-----\n\nc3ludGhldGlj\n-----END PGP SIGNATURE-----\n ',
    'quoted-signature': 'Technical example mentioning Codex\n\n```text\n-----BEGIN PGP SIGNATURE-----\n\nCo-authored-by: Claude <legacy-ai>\n```',
    'fake-signature': 'Release\n-----BEGIN SSH SIGNATURE-----\n\nCo-authored-by: Codex <legacy-ai>',
    'post-signature': 'Release\n-----BEGIN PGP SIGNATURE-----\nc3ludGhldGlj\n-----END PGP SIGNATURE-----\n\nCo-authored-by: Codex <legacy-ai>',
    'multiple-signature': 'Release\n\nCo-authored-by: Codex <legacy-ai>\n-----BEGIN PGP SIGNATURE-----\n\nc3ludGhldGlj\n-----END PGP SIGNATURE-----\n-----BEGIN PGP SIGNATURE-----\n\nc3ludGhldGlj\n-----END PGP SIGNATURE-----'
  };
  const inner = tag(repo, head, { tagger: kind === 'tagger' || kind === 'nested' ? 'Claude <legacy-ai> 1700000000 +0000' : undefined, message: messages[kind] });
  const selected = kind === 'nested' ? tag(repo, inner, { type: 'tag' }) : inner; setRef(repo, selected, 'refs/tags/release');
  const result = audit({ repo, mode: 'publication', publication: publication(repo, ['refs/heads/main', 'refs/tags/release']) });
  const expected = ['human', 'quoted-signature'].includes(kind) ? 0 : ['fake-signature', 'post-signature', 'multiple-signature'].includes(kind) ? 2 : 1;
  assert.equal(result.exitCode, expected);
  if (expected !== 2) assert.equal(result.scope.annotatedTagCount, kind === 'nested' ? 2 : 1);
  if (expected === 1) assert.ok(result.violations.some(v => v.object === inner && v.objectType === 'tag'));
  if (expected === 2) assert.equal(result.errors[0].rule, 'metadata.tag-signature');
});
test('fake terminal armor containing identity trailers fails incomplete, not clean', () => {
  const repo = createRepo(root, `fake-armor-${serial++}`), head = commit(repo); setRef(repo, head);
  setRef(repo, tag(repo, head, { message: 'Release\n-----BEGIN PGP SIGNATURE-----\nCo-authored-by: Claude <legacy-ai>\n-----END PGP SIGNATURE-----' }), 'refs/tags/release');
  const result = audit({ repo, mode: 'publication', publication: publication(repo, ['refs/tags/release']) }); assert.equal(result.exitCode, 2); assert.equal(result.clean, false); assert.equal(result.errors[0].rule, 'metadata.tag-signature');
});
test('legacy tag without tagger preserved in known mode, fails unknown strict admission; malformed tag fails incomplete', () => {
  const repo = createRepo(root, 'tag-metadata'), head = commit(repo); setRef(repo, head); setRef(repo, tag(repo, head, { tagger: null }), 'refs/tags/release');
  const input = { repo, mode: 'publication', publication: publication(repo, ['refs/tags/release']) };
  assert.equal(audit(input).exitCode, 0); assert.equal(audit({ ...input, config: { mode: 'approved' } }).exitCode, 1);
  const malformed = tag(repo, head, { tagger: 'Malformed tagger' }); setRef(repo, malformed, 'refs/tags/release');
  const result = audit({ ...input, publication: publication(repo, ['refs/tags/release']) }); assert.equal(result.exitCode, 2); assert.equal(result.errors[0].object, malformed); assert.equal(result.errors[0].field, 'tagger');
  setRef(repo, tag(repo, head, { type: 'tag' }), 'refs/tags/release'); assert.equal(audit({ ...input, publication: publication(repo, ['refs/tags/release']) }).exitCode, 2);
});
