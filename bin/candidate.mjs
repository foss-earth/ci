#!/usr/bin/env node
import { prepareCandidate } from '../src/candidate.mjs';
import { readJson } from '../src/audit.mjs';
try {
  const input = readJson(process.argv[2]);
  const result = prepareCandidate(input); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.exitCode;
} catch { process.stdout.write('{"ready":false,"admission":false,"exitCode":2,"errors":["Invalid candidate input or incomplete history"]}\n'); process.exitCode = 2; }
