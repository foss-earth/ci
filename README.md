# Common CI and attribution

`@foss-earth/ci` is the independent common policy component. It has no globe,
flight or campus runtime dependency, and uses Node 22+ and Git. Version 0.1.0
is a private staging candidate; registry publication is separate.

YOU CANNOT HAVE AI AS A CO-AUTHOR, OR YOUR CONTRIBUTIONS WILL BE REJECTED.

The canonical policy also rejects AI author and committer identities and
structured attribution trailers. Deny-known mode identifies reviewed aliases;
it does not recognize every possible AI identity or prove that a name is human.
Approved mode rejects unknown name/address pairs pending documented onboarding.
Organization configuration only adds prohibitions and reviewed human/non-AI
automation entries. Canonical AI matches always win over approval entries.

Run the installed executable, not a copied validator:

```sh
node node_modules/@foss-earth/ci/bin/attribution.mjs --repo . --refs-file publication.json
node node_modules/@foss-earth/ci/bin/attribution.mjs --repo . --base FULL_OID --head FULL_OID
node node_modules/@foss-earth/ci/bin/conformance.mjs --consumer . --trusted-release reviewed-release.json --output-root build/conformance
```

The publication file explicitly identifies the intended source and selected
branch/tag refs. Every reachable raw parent is inspected, including annotated
tag targets. A branch-only scope is reported as such. Missing refs/objects,
malformed metadata, shallow history, grafts, replacement refs or source drift
fail incomplete with exit 2. Complete policy violations exit 1; only a clean
complete scope exits 0. No inspected hooks or application code run, and mailmap
does not affect recorded identities. Receipts omit identity addresses/messages
and source URLs to avoid credential leakage.

`npm run ci` runs JavaScript/JSON checks and one-worker synthetic regressions.
Fixtures remain in ignored build/. `npm run package` packages a clean committed
Git snapshot as an npm-installable deterministic archive and emits a trusted
release descriptor with source/artifact/policy/file digests. Consumers pin the
reviewed source SHA in their actual workflow and install the exact archive.
No neighboring source link qualifies a production install.

Public exports are audit, policy, fixtures, conformance, templates and candidate.
The scaffold executable prints proposed files by default; `--write-empty` only
writes absent files in a primary writer's assigned empty destination. Each
repository adopts the caller explicitly, including docs/data/assets/.github.
Component tests stay with that component. No metadata check has changed-path,
optional language-suite or manual-only conditions.

See [contracts](docs/contracts.md), [admission and bootstrap](docs/admission.md)
and [consumer migration](docs/consumer-migration.md). Hosted admission and
cleanup are coordinator responsibilities. No hosted acceptance is claimed by
local tests.
