import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const paths = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'build', 'node_modules'].includes(entry.name)) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith('.mjs')) paths.push(path);
    else if (entry.name.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
  }
}
visit(process.cwd());
for (const path of paths) {
  const run = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 2);
}
process.stdout.write(`Checked JavaScript syntax and JSON for ${paths.length} modules; no TypeScript sources.\n`);
