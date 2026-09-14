# ADR-005: Release-set preparation boundary

- Status: Accepted
- Date: 2026-09-14
- Owner: @soulbah
- Related spec: `specs/004-release-set-preparation/spec.md`

## Context

Supplied Dialects and RF Vocabulary now travel with the verified Rootform
binary as one release set. Project lock contains only explicit external
Dialects, Policy Pack sources, exclusions, and replacements. Existing Action
preparation assumes supplied Dialects are independently discovered, installed,
vendored, and cached, and assumes initialization may generate a lock.

## Decision

- Keep one explicit `rootform init` call before analysis.
- Interpret it only as verification/acquisition of exact lock-selected external
  content.
- Cache only installed Dialects and Policy Pack source packages.
- Remove generated-lock behavior and old resolution/coverage reporting.
- Keep `locked`, `offline`, and cache opt-out inputs because they still map
  directly to CLI behavior.
- Rename public output to `preparation-mode` and remove `lock-created`.
- Keep analysis network-free. Preparation alone may use network for immutable
  OCI identities already pinned by lock.

## Consequences

A project using only supplied semantics needs no lock and prepares as a no-op.
Changing Rootform version changes supplied knowledge through the release set,
not through Action cache. Projects with external selections remain reproducible
through exact lock pins and explicit preparation. Old Action envelope and
outputs are intentionally unsupported before v0.1.

## Rejected alternatives

- Cache release-set content separately: binary already carries and verifies it.
- Preserve generated locks: init no longer selects dependencies or writes lock.
- Parse lock in Node: duplicates CLI authority and creates a second contract.
- Keep old output names as aliases: pre-v0.1 replacement has no compatibility
  layer.
