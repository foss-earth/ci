#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit, readJson } from '../src/audit.mjs';
import { AuditError, git, oid, refName } from '../src/git.mjs';
import { hostedConformance } from '../src/hosted-conformance.mjs';
import { initializeHostedSubject } from '../src/hosted-subject.mjs';
import { hostedFailure } from '../src/hosted-diagnostics.mjs';

let stage = 'read-event';
try {
  const event = readJson(process.env.GITHUB_EVENT_PATH);
  stage = 'validate-event';
  const repository = process.env.SOURCE_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository !== process.env.GITHUB_REPOSITORY) throw new AuditError('hosted.event-identity', 'Source repository must be the event repository');
  stage = 'initialize-subject';
  const { root, repo } = initializeHostedSubject(resolve('build/hosted'));
  const url = `https://github.com/${repository}.git`;
  stage = 'fetch-publication';
  git(repo, ['fetch', '--no-write-fetch-head', '--no-tags', url, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
  let result, baseline, consumerHead;
  const name = process.env.GITHUB_EVENT_NAME;
  if (name === 'pull_request' || name === 'merge_group') {
    let base, head;
    stage = 'fetch-event';
    if (name === 'pull_request') {
      base = oid(event.pull_request.base.sha); head = oid(event.pull_request.head.sha);
      if (!Number.isSafeInteger(event.number) || event.number < 1) throw new AuditError('hosted.event-number', 'Invalid PR number');
      git(repo, ['fetch', '--no-write-fetch-head', url, `refs/pull/${event.number}/head`]);
    } else { base = oid(event.merge_group.base_sha); head = oid(event.merge_group.head_sha); }
    git(repo, ['fetch', '--no-write-fetch-head', url, base, head]);
    stage = 'resolve-range';
    const rangeBase = oid(git(repo, ['merge-base', base, head]));
    stage = 'audit-range'; result = audit({ repo, mode: 'range', base: rangeBase, head });
    result.scope.eventBase = base;
    baseline = base; consumerHead = head;
    result.admission = 'PR/merge-group metadata evidence only. Final protected-ref admission requires coordinator-verified exact-candidate validation.';
  } else if (name === 'push' || name === 'workflow_dispatch' || name === 'workflow_call') {
    stage = 'read-publication-refs';
    const refs = git(repo, ['ls-remote', '--heads', '--tags', '--refs', url]).split('\n').filter(Boolean).map(line => { const [id, ref] = line.split('\t'); return { name: refName(ref), oid: oid(id) }; });
    stage = 'audit-publication'; result = audit({ repo, mode: 'publication', publication: { schemaVersion: 1, source: { id: repository, location: url }, refs } });
    result.admission = 'Publication audit is detection; this job does not prevent a push already admitted.';
    stage = 'resolve-baseline'; baseline = oid(event.after ?? process.env.PUBLICATION_BASELINE); consumerHead = baseline;
  } else throw new AuditError('hosted.event-type', 'Unsupported event');
  result.conformance = hostedConformance({ subject: repo, baseline, head: consumerHead, root, toolRoot: process.cwd(), onStage: value => { stage = value; } });
  if (result.conformance.exitCode !== 0) { result.clean = false; result.exitCode = result.conformance.exitCode; }
  stage = 'write-result'; const text = `${JSON.stringify(result, null, 2)}\n`; writeFileSync(resolve(root, 'audit.json'), text); process.stdout.write(text); process.exitCode = result.exitCode;
} catch (error) { process.stdout.write(`${JSON.stringify(hostedFailure(error, stage))}\n`); process.exitCode = 2; }
