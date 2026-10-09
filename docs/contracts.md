# Version 1 contracts

Publication input:

```json
{
  "schemaVersion": 1,
  "source": { "id": "reviewed-publication-source", "location": "https://github.com/organization/repository.git" },
  "refs": [{ "name": "refs/heads/main", "oid": "FULL_LOWERCASE_OID", "commit": "OPTIONAL_PEELED_COMMIT_OID" }]
}
```

Only explicit heads/tags are selected; no negative filters or guessed origin.
The direct OID must match both the local ref and source advertisement before
and after inspection. For extracted candidates use the coordinator's explicit
isolated local publication source until the canonical remote is admitted.
Git replacement environment/config is disabled for reads and traversal;
replacement refs and nonempty grafts are rejected. Raw parent recursion and
content-address verification detect missing/corrupt objects independently of
Git's traversal overlays. Annotated tags are resolved recursively. Every raw
commit has one author/committer/tree and valid timestamp/timezone/UTF-8 metadata.
Legacy non-UTF-8 metadata requires explicit coordinator repair/provenance review;
it cannot silently pass. Valid optional signed headers may have continuations.

Identity normalization is NFKC, trimming, collapsed Unicode whitespace and
lowercase. Whole normalized name/address matches and exact domain or its explicit
subdomains are tested. No company-wide AI domains are assumed. Similar full
human names remain allowed. Trailer keys normalize whitespace, hyphens and
underscores. Structured identity lines in the terminal paragraph count;
folded values work and unrelated prose cannot cancel one. Quotes and fenced
examples do not count. Ordinary product mentions do not count. Identity-bearing
trailers require Name <address>; malformed ones fail closed. Technical notices
and credits for human contributors remain valid. Unknown aliases are a known
denylist limitation, never claimed universal detection.

Optional `--config` JSON contains only schemaVersion, mode (`deny-known` or
`approved`), approvedIdentities (name/email/kind/review), extraForbiddenNames,
extraForbiddenEmails and extraForbiddenDomains. Duplicate normalized aliases
and approvals fail. Canonical prohibitions cannot be removed or overridden.

Result schemaVersion=1 contains tool/mode/policy (id/version/digest/mode), exact
scope (selected refs or base/head, count and commit-set digest), complete/clean,
violations (commit/field/rule/repair), errors and exitCode. Exit 0 means complete
and clean, 1 means complete but rejected, 2 means incomplete/invalid. A proposed
range is all head-reachable commits minus base-reachable commits; base must be
an ancestor. It never substitutes for the full publication-ref audit.

Reusable workflow `.github/workflows/attribution.yml`: required string inputs
validator-revision (immutable common source SHA) and source-repository (event
repository slug). Required local caller job `attribution`; called job name
`Attribution policy`. Expected combined check is `attribution / Attribution policy`;
coordinator must confirm the actual GitHub check context/application ID before
protecting each remote. Permissions are contents:read; no secrets inheritance.
PR, merge_group checks_requested and all pushes trigger the canonical caller.
The reusable workflow verifies its sealed trusted executable/policy/fixture
hashes before running code; an input revision cannot replace these bytes.

Conformance v1 requires consumer path, externally reviewed release descriptor,
and ignored owner build output root. The descriptor records package/version,
revision, exact archive SHA-256, policy SHA-256 and installed component file
digests. `.attribution.json` must declare that exact release and installed Node
entry point. Caller must match the canonical unconditional SHA-pinned template.
The actual installed entry point runs the shared allowed-human plus Claude,
Cursor and Codex author/committer/coauthor matrix. Result names the consumer,
pins, required check, individual expected/actual statuses and completeness.
Fixture repositories are owned ignored storage, never real publication history.

Exact candidate API accepts repository, protected base/head/tree OIDs, controlled
merge or squash, explicit final author/committer raw identities/message and
optional tighter config. It validates proposed ancestry first, constructs only
an unattached commit object and audits its final metadata. Ready is evidence,
not admission: admission=false always. Other merge methods remain disabled.
