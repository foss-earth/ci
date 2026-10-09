# Primary writer migration

1. Obtain the reviewed `release.json`, exact `.tgz` and accepted source SHA from
   platform/coordinator. Verify archive SHA-256 and size before install. Track
   its unchanged bytes at `deps/foss-earth-ci-SOURCE_SHA.tgz`, exactly as named
   by `release.json.artifactPath`, together with the reviewed descriptor, caller
   and any required lockfile update in your own repository. No registry
   or source link assumption. Keep local linking explicit and separate.
2. Run scaffold `--print DESTINATION RELEASE.json` and adopt reviewed caller,
   `.attribution.json`, `.attribution-release.json`, contribution/agent rules.
   `--write-empty` may be used by the assigned owner for an empty destination.
   Fill local README responsibility/exports, component build/test hooks,
   licensing/provenance, release identity and compatibility. Add a local
   attribution script invoking `node node_modules/@foss-earth/ci/bin/attribution.mjs`
   and a shared conformance script invoking the installed conformance executable.
   Templates do not copy validators and organization .github does not install
   running workflows automatically.
3. Run installed conformance with externally trusted release descriptor in
   ignored build/, including docs/data/content/logo/installer/CI/.github repos.
   Retain individual human and brand/field statuses. Execute complete selected
   publication-ref audit, listing intended source and every published branch/tag.
   Legacy violations fail until the coordinator cleans them; no grandfathering.
4. Hand coordinator source/artifact/policy/caller pins, conformance result,
   complete audit and expected required-check identity. Coordinator verifies
   each real remote's admission, bypass settings and negative rehearsals. Missing
   remote evidence remains a blocked migration gate.

Updates: review new common code/policy/fixtures and complete history; package
in the recorded producer environment; exercise code, data and documentation consumers; distribute
new descriptor/artifact; coordinator uses its separate protected update path to
change caller, protected descriptor and exact dependency blob together; re-run installed conformance
and remote negative admission. The old exact artifact remains rollback input.
Do not change pins from an ordinary PR to bypass the baseline validation rule.

The source release commit is R1. Package that clean snapshot, then make an R2
self-adoption commit containing R1's exact archive and SHA-pinned caller. This
avoids an archive recursively containing itself. Consumers adopt the same R1
descriptor and archive; R2 is the common repository's proposed publication head.

Current releases require `executableSealVersion: 2`: package metadata and all
tracked bin, src, policy, fixtures and scripts files are sealed. Hosted code
compares this complete inventory with immutable R1 Git blobs before installing;
installed conformance verifies those bytes before importing component modules.
Preserved old releases retain their original seal scope and evidence.
