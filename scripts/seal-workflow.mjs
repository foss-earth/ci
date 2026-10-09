import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest } from '../src/policy.mjs';
const files = [];
for (const directory of ['src', 'bin', 'policy', 'fixtures']) for (const entry of readdirSync(directory).sort()) if (/\.(mjs|json)$/.test(entry)) files.push(`${directory}/${entry}`);
const sums = files.map(path => `${digest(readFileSync(path))}  ${path}`).join('\n');
const workflow = `name: Common attribution\non:\n  workflow_call:\n    inputs:\n      validator-revision:\n        required: true\n        type: string\n      source-repository:\n        required: true\n        type: string\npermissions:\n  contents: read\njobs:\n  policy:\n    name: Attribution policy\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Read candidate common component\n        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n        with:\n          repository: foss-earth/ci\n          ref: \${{ inputs.validator-revision }}\n          persist-credentials: false\n      - name: Verify trusted implementation bytes\n        shell: bash\n        run: |\n          sha256sum --check <<'TRUSTED_FILES'\n${sums.split('\n').map(line => `          ${line}`).join('\n')}\n          TRUSTED_FILES\n      - name: Validate raw metadata from explicit event source\n        env:\n          SOURCE_REPOSITORY: \${{ inputs.source-repository }}\n        run: node bin/hosted.mjs\n`;
mkdirSync('.github/workflows', { recursive: true }); writeFileSync('.github/workflows/attribution.yml', workflow);
process.stdout.write(`Sealed ${files.length} trusted files into reusable workflow. Reseal after any implementation change.\n`);
