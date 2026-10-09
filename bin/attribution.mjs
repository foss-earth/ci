#!/usr/bin/env node
import { audit, readJson } from '../src/audit.mjs';

export function argumentsMap(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--repo', '--refs-file', '--base', '--head', '--config'].includes(args[i]) || !args[i + 1] || values[args[i]] !== undefined) throw new Error('Invalid or duplicate argument');
    values[args[i]] = args[i + 1];
  }
  if (!values['--repo'] || Boolean(values['--refs-file']) === Boolean(values['--base'] || values['--head'])) throw new Error('Supply --repo and either --refs-file or --base/--head');
  return values;
}
try {
  const values = argumentsMap(process.argv.slice(2));
  const result = audit({ repo: values['--repo'], mode: values['--refs-file'] ? 'publication' : 'range', publication: values['--refs-file'] ? readJson(values['--refs-file']) : undefined, base: values['--base'], head: values['--head'], config: values['--config'] ? readJson(values['--config']) : undefined });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.exitCode;
} catch {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, complete: false, clean: false, exitCode: 2, errors: [{ rule: 'input.invalid', detail: 'Use --repo PATH --refs-file JSON or --repo PATH --base OID --head OID; optional --config JSON' }] })}\n`);
  process.exitCode = 2;
}
