# Trusted controller and service binding

The controller export prepares a merged integration tree with Git merge-tree,
validates proposed and exact final commit metadata through the one common
validator, verifies protected-baseline release/config/caller pins, and audits
the complete explicit advertised branch/tag set including annotated tags.
Unknown published refs fail; no backup or staging ref is silently excluded.
Only reviewed merge/squash methods are allowed. Tags need a separate reviewed
admission route; this branch controller refuses unsafe tag ref writes.

Stage validates every published ancestor plus the exact unattached candidate
before creating refs/heads/admission/<candidate>. Its branch is published history,
so clean staging is not an attribution exception. The returned explicit
publicationRefsAfterStage must be recorded into the trusted service's scope and
fetched locally before admission. Concurrent/unknown stages require explicit
state reconciliation and complete audit. No broad staging-name negative filter.

Admission reconstitutes the same candidate from current protected base and
proposed ref, verifies exact owner-check name/App/workflow SHA/head/success and
trusted job proof and repeats source/base/head audits after checks. Publishing
then requires a separately bound publishGuarded operation that owns the write,
validates the complete advertised publication snapshot and proposal head, and
excludes every independent writer through transaction acceptance. There is no
direct protected-branch push fallback. Git protocol
--force-with-lease=REF:EXPECTED_OLD atomically protects only that branch's old
value; it cannot prevent proposal/tag/other-branch drift. GitHub REST ref update
has no expected-old equivalent and is not used. Local fixtures exercise the
guard contract and protected-base lease; they do not qualify a remote freeze.
The transport disables follow-tags and recursive submodule pushes explicitly;
local push configuration cannot add an unaudited publication ref. Subject Git
configuration containing includes, URL rewrites or command-capable settings is
rejected before transport or merge-tree; use an isolated object replica. Service
SSH authentication may use its externally bound agent, never subject-configured
helpers. HTTPS service credential transport still needs a separately reviewed
binding rather than enabling inspected credential helpers.

Default publish=false yields a reviewable candidate and never writes a ref.
Only the coordinator's restricted trusted process may enable publishing.
GitLeaseTransport is a low-level trusted-service primitive, not a policy bypass
for untrusted callers. Source/config/pins and credentials never come from PR code.
The controller never executes source hooks, build scripts or application tests.
Unprivileged jobs test the exact clean staged candidate; no controller write
credential reaches them. Controller checks receipts only from its trusted gateway,
never a JSON receipt supplied by a contributor.

Required trusted config schemaVersion 1 contains ciRelease (exact externally
reviewed descriptor), optional tighter policy, and exact targets map: source,
sourceBindingId, admissionGuard {id,version}, protectedRef, complete
publicationRefs, allowedMethods, ownerChecks array of
actual name/appId/workflowPath/workflowSha and purpose (domain or
consumer-conformance). At least one consumer-conformance check is mandatory.
The controller verifies its installed executable/policy/fixture bytes with the
shared release-integrity routine and requires canonical pins/callers on both
protected base and proposed head. No wildcard targets or placeholder
actor IDs qualify. source-repo objects/refs must be fetched into the controller's
isolated subject. prepareAdmission receives target/proposalRef/expectedHead,
method and explicit final metadata. controlledAdmission receives phase stage or
admit, unchanged candidate, trusted readTrustedChecks callback, publishGuarded
operation and publish flag.

publishGuarded receives target/sourceBindingId/protectedRef/candidate/expectedBase,
proposal {ref,expectedHead}, sorted publicationSnapshot [{ref,oid}] and its
SHA-256, verified check-witness digest, exact ciPin and guard {id,version}.
It resolves its reviewed source/credential binding independently and must fail
if complete snapshot or proposal differs, or enforced exclusion cannot be
established. Its receipt must match target/ref/old/new/proposalHead, snapshot
and check-witness digests, ciPin and guard identity/version, with accepted=true
and a nonempty transactionId. Missing/mismatched receipts leave admission
unverified. These trusted service results cannot be contributor JSON or a
Boolean substituted for remote proof. A process mutex or pre-push ls-remote
does not exclude other controllers, admins, branch/tag writers, GitHub merge
queue or independently writable fork/refs/pull heads. Such sources remain
unbound until a reviewed backend can enforce the required exclusion. A service
returning an incorrect receipt may already have changed its remote; preserve
that evidence and reconcile externally rather than retrying blindly.

GitHubChecksGateway reads check runs and their Actions run metadata from the
fixed official API, requires the exact candidate and run/check-suite linkage,
and records immutable referenced workflows. It deliberately does NOT treat a
run-level referenced workflow as proof of a particular job: a malicious same-PR
caller can reference a trusted workflow while manufacturing another job/check.
trustedJobProof remains false unless the service provides verifyTrustedJob that
verifies a pinned job's OIDC witness (issuer/audience/repository/ref/head/job
workflow ref/SHA, attempt and exact check/job binding) or an equivalent dedicated
trusted check-provider proof. A submitted Boolean/JSON statement is not proof.
For the conformance check, the witness verifier must also attest that the exact
candidate ran the shared conformance command through its actual installed entry
point, all required positive/negative cases passed, and the returned release pin
matches ciRelease. Its trusted return object has trustedJobProof,
conformanceVerified and conformancePin (revision/artifactSha256/policySha256).
The service obtains that result from the pinned job/check issuer, never a
contributor-supplied receipt. A run-level reference or success conclusion alone
does not satisfy this gate.
No token issuance, JWT verification service, App registration or hosting is
silently implemented/installed by this package.

Needed coordinator binding: install a scoped controller/check issuer; exact
target allowlist and per-target restricted branch/tag/bypass rules; actual App
IDs/check contexts and immutable owner workflows that run protected commands
on the exact candidate without caller-controlled skips; authenticated Git
read/write transport outside untrusted jobs; trusted-job witness verification;
guarded complete-snapshot publication backend; negative and racing admission
rehearsals. App permissions and user authorization
must be reviewed before credential/service installation. No current App was
assumed. Admin/org owners remain an explicit trusted-administration boundary.
Without those bindings the controller fails closed and hosted enforcement stays
INCOMPLETE; local tests cannot qualify an absent service or remote ruleset.

Primary metadata references checked 2026-10-08: [workflow run metadata](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run), [Git reference check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference).
