import { oid, AuditError } from './git.mjs';
export function githubChecksGateway({ token, fetchImpl = fetch, verifyTrustedJob }) {
  if (typeof token !== 'string' || !token) throw new AuditError('admission.credentials', 'Coordinator must bind a scoped service read credential outside untrusted jobs');
  async function get(path) {
    const response = await fetchImpl(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'user-agent': 'foss-earth-admission/1.0' }, redirect: 'error' });
    if (!response.ok) throw new AuditError('admission.check-api', 'Trusted GitHub metadata request failed; no credentials logged');
    return response.json();
  }
  return async ({ target, candidate }) => {
    oid(candidate);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target)) throw new AuditError('admission.target', 'Invalid bound target');
    const prefix = `/repos/${target}`, rows = [];
    let page = 1;
    while (true) {
      const result = await get(`${prefix}/commits/${candidate}/check-runs?filter=latest&per_page=100&page=${page++}`);
      if (!Array.isArray(result.check_runs)) throw new AuditError('admission.check-api', 'Malformed check-run metadata');
      for (const check of result.check_runs) {
        const match = new RegExp(`^https://github\\.com/${target.replaceAll('.', '\\.')}\/actions\/runs\/(\\d+)\/job\/(\\d+)$`).exec(check.details_url ?? '');
        if (!match) continue;
        const run = await get(`${prefix}/actions/runs/${match[1]}`);
        if (run.head_sha !== candidate || run.check_suite_id !== check.check_suite?.id || run.status !== 'completed') continue;
        // Only immutable referenced reusable workflows qualify, never a same-PR caller file.
        for (const workflow of run.referenced_workflows ?? []) {
          const row = { name: check.name, appId: check.app?.id, headSha: check.head_sha, status: check.status, conclusion: check.conclusion, workflowPath: workflow.path, workflowSha: workflow.sha };
          // A run-level referenced workflow does not authenticate a particular job.
          // Service must verify a pinned-job OIDC witness or equivalent trusted issuer proof.
          const witness = typeof verifyTrustedJob === 'function' ? await verifyTrustedJob({ target, candidate, check, run, workflow, jobId: Number(match[2]) }) : false;
          row.trustedJobProof = witness === true || witness?.trustedJobProof === true;
          row.conformanceVerified = witness?.conformanceVerified === true;
          if (row.conformanceVerified) row.conformancePin = witness.conformancePin;
          rows.push(row);
        }
      }
      if (result.check_runs.length < 100) break;
    }
    return rows;
  };
}
