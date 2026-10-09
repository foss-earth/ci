import { readFileSync } from 'node:fs';
import { policyPath } from './policy.mjs';

const canonical = JSON.parse(readFileSync(policyPath, 'utf8'));
export const requiredCheck = 'attribution / Attribution policy';
export function callerTemplate(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Reviewed immutable GitHub SHA required');
  return `name: Attribution\non:\n  pull_request:\n  merge_group:\n    types: [checks_requested]\n  push:\npermissions:\n  contents: read\njobs:\n  attribution:\n    uses: foss-earth/ci/.github/workflows/attribution.yml@${revision}\n    with:\n      validator-revision: ${revision}\n      source-repository: \${{ github.repository }}\n    permissions:\n      contents: read\n`;
}
export function consumerConfig(release) {
  return { schemaVersion: 1, component: '@foss-earth/ci', revision: release.revision, artifactSha256: release.artifactSha256, policySha256: release.policySha256, entryPoint: ['node', 'node_modules/@foss-earth/ci/bin/attribution.mjs'], workflow: '.github/workflows/attribution-check.yml', requiredCheck };
}
export const policyRule = canonical.rule;
export const policyRationale = Object.values(canonical.rationale).join('\n\n');
export const contributionTemplate = `# Contributing

Thank you for improving this project. Before opening a pull request, discuss material new features or large changes in an issue so the implementation fits the project's direction.

## Development

Follow this repository README for setup and checks. Use public exports, linked source, pinned packages or supported hybrid selections. Follow the owning language, strict types, formatting and lint rules; keep changes focused with meaningful tests. Do not add generated build output, credentials, API keys, vendor copies or unrelated formatting changes.

## Rights and licensing

By submitting a contribution, you confirm that you have the right to submit it under the repository's applicable licensing terms and that it does not include confidential, proprietary, or copied material without permission. Identify all third-party code, data, models, textures, sounds, fonts, and references in the pull request.

Creative assets need explicit provenance records and the owning repository asset-license guidance. Do not submit a model or reference merely because it is publicly downloadable.

## Pull requests

Explain the user-visible result, relevant tests, and any limitations. Update documentation when public behavior, setup, data sources, or licensing changes. Maintainers may request a smaller change, more tests, or provenance evidence before merge.

## Commit attribution

${policyRule}

${policyRationale}

AI author, committer and identity-bearing attribution trailers are also prohibited.
Preserve legitimate human credit and asset/license provenance. Technical discussion
of tools is permitted. Onboard identities through the reviewed registry when
approved mode is enabled. Run the installed common validator and consumer conformance
locally, then the component's documented checks. Authorship checks run on every
change, including documentation and content. Workflow/policy updates use the
coordinator's trusted review path. Never publish synthetic invalid fixture commits.
`;
export const agentTemplate = `# Agent instructions

${policyRule}

This repository owns the responsibility stated in README.md. Use public pinned
contracts. Preserve dirty work and evidence. Scratch/logs go in ignored build/.
Run the installed common attribution validator and consumer conformance; do not
copy their implementation. Reserve shared heavy-check capacity. No implicit server,
benchmark, native/WASM build, history rewrite, remote enforcement change or deploy.
Never add AI author, committer or coauthor attribution to commits. Branded AI
contribution credits are advertising and may imply endorsement. The person submitting
work remains accountable for accuracy, review responses, provenance and rights.
Preserve required license notices, factual tool documentation and legitimate human credit.
`;
