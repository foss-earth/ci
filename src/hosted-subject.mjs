import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { git } from './git.mjs';
export function initializeHostedSubject(outputRoot) {
  const root = resolve(outputRoot), repo = resolve(root, 'subject.git');
  // git -C needs the subject itself to exist in a completely fresh runner directory.
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--bare', '--quiet']);
  return { root, repo };
}
