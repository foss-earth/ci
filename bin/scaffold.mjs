#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readJson } from '../src/audit.mjs';
import { callerTemplate, consumerConfig, contributionTemplate, agentTemplate } from '../src/templates.mjs';
// Print reviewed content by default; explicitly select --write-empty for empty destinations.
const [mode, target, descriptor] = process.argv.slice(2);
if (!['--print', '--write-empty'].includes(mode) || !target || !descriptor) throw new Error('Use --print|--write-empty DESTINATION RELEASE.json');
const release = readJson(descriptor);
const files = { '.github/workflows/attribution-check.yml': callerTemplate(release.revision), '.attribution.json': `${JSON.stringify(consumerConfig(release), null, 2)}\n`, '.attribution-release.json': `${JSON.stringify(release, null, 2)}\n`, 'CONTRIBUTING.md': contributionTemplate, 'AGENTS.md': agentTemplate, '.gitignore': '/build/\n/node_modules/\n', 'README.md': '# Component repository\n\nPrimary owner must fill responsibility, public exports, local installation/build/test commands, component test hooks, license/provenance, exact release identity and compatibility before adoption. Install the exact @foss-earth/ci artifact from .attribution-release.json, run its shared conformance and invoke its bin/attribution.mjs for local checks. This scaffold is not an admission receipt.\n' };
if (mode === '--print') process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
else {
  for (const path of Object.keys(files)) if (existsSync(resolve(target, path))) throw new Error(`Existing file needs primary-owner review: ${path}`);
  for (const [path, text] of Object.entries(files)) { mkdirSync(resolve(target, path, '..'), { recursive: true }); writeFileSync(resolve(target, path), text, { flag: 'wx' }); }
}
