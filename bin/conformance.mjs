#!/usr/bin/env node
import { conformance } from '../src/conformance.mjs';
import { readJson } from '../src/audit.mjs';
try {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--consumer', '--trusted-release', '--output-root'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error('Arguments');
    values[args[i]] = args[i + 1];
  }
  const result = conformance({ consumer: values['--consumer'], release: readJson(values['--trusted-release']), outputRoot: values['--output-root'] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.exitCode;
} catch { process.stdout.write('{"complete":false,"clean":false,"exitCode":2,"errors":["Use --consumer PATH --trusted-release JSON --output-root ignored/build/PATH"]}\n'); process.exitCode = 2; }
