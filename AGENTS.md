# Agent instructions

This repository owns common metadata validation, attribution policy, reusable CI,
consumer conformance and generic repository templates. Consumers own their callers.

You cannot have AI as a co-author, or your contributions will be rejected.

Branded AI contribution credits are advertising and may imply endorsement.
The person submitting work remains accountable for accuracy, review responses,
provenance and rights. Preserve required license notices, factual tool documentation
and legitimate human credit.

AI author, committer and identity-bearing attribution trailers are prohibited.
Preserve permitted human identities and non-AI automation provenance. Never add
invalid fixture commits to this repository: create them only under ignored build/.

Scratch and retained run logs belong in build/. Never delete evidence folders.
Reserve the shared migration check slot through the platform handoff before checks.
Run npm run typecheck, npm run lint and related tests during implementation;
run npm run ci once for the finished candidate. Use one test worker. No server,
benchmark, native/WASM build, remote administration or publication implicitly.
