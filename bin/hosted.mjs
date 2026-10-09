#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit, readJson } from '../src/audit.mjs';
import { git, oid, refName } from '../src/git.mjs';
import { hostedConformance } from '../src/hosted-conformance.mjs';
import { initializeHostedSubject } from '../src/hosted-subject.mjs';

try {
  const event = readJson(process.env.GITHUB_EVENT_PATH);
  const repository = process.env.SOURCE_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository !== process.env.GITHUB_REPOSITORY) throw new Error('Source repository must be the event repository');
  const { root, repo } = initializeHostedSubject(resolve('build/hosted'));
  const url = `https://github.com/${repository}.git`;
  git(repo, ['fetch', '--no-write-fetch-head', '--no-tags', url, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
  let result, baseline, consumerHead;
  const name = process.env.GITHUB_EVENT_NAME;
  if (name === 'pull_request' || name === 'merge_group') {
    let base, head;
    if (name === 'pull_request') {
      base = oid(event.pull_request.base.sha); head = oid(event.pull_request.head.sha);
      if (!Number.isSafeInteger(event.number) || event.number < 1) throw new Error('Invalid PR number');
      git(repo, ['fetch', '--no-write-fetch-head', url, `refs/pull/${event.number}/head`]);
    } else { base = oid(event.merge_group.base_sha); head = oid(event.merge_group.head_sha); }
    git(repo, ['fetch', '--no-write-fetch-head', url, base, head]);
    const rangeBase = oid(git(repo, ['merge-base', base, head]));
    result = audit({ repo, mode: 'range', base: rangeBase, head });
    result.scope.eventBase = base;
    baseline = base; consumerHead = head;
    result.admission = 'PR/merge-group metadata evidence only. Final protected-ref admission requires coordinator-verified exact-candidate validation.';
  } else if (name === 'push' || name === 'workflow_dispatch' || name === 'workflow_call') {
    const refs = git(repo, ['ls-remote', '--heads', '--tags', '--refs', url]).split('\n').filter(Boolean).map(line => { const [id, ref] = line.split('\t'); return { name: refName(ref), oid: oid(id) }; });
    result = audit({ repo, mode: 'publication', publication: { schemaVersion: 1, source: { id: repository, location: url }, refs } });
    result.admission = 'Publication audit is detection; this job does not prevent a push already admitted.';
    baseline = oid(event.after ?? process.env.PUBLICATION_BASELINE); consumerHead = baseline;
  } else throw new Error('Unsupported event');
  result.conformance = hostedConformance({ subject: repo, baseline, head: consumerHead, root, toolRoot: process.cwd() });
  if (result.conformance.exitCode !== 0) { result.clean = false; result.exitCode = result.conformance.exitCode; }
  const text = `${JSON.stringify(result, null, 2)}\n`; writeFileSync(resolve(root, 'audit.json'), text); process.stdout.write(text); process.exitCode = result.exitCode;
} catch { process.stdout.write('{"complete":false,"clean":false,"exitCode":2,"errors":[{"rule":"hosted.failure","detail":"Failed explicit event/ref/source preparation; inspect GitHub fetch availability"}]}\n'); process.exitCode = 2; }
