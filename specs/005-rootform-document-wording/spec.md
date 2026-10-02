# SPEC-005: Rootform document wording

> Historical specification. SPEC-006 replaces its active Action surface on 2026-10-02.

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-09-26 (Form vocabulary decision validated; end-to-end
  migration mandated; published Action inputs and outputs keep their names)
- Created: 2026-09-26
- Updated: 2026-09-26
- Related ADRs: None

## Problem

Rootform retired the name "Architecture IR". The saved JSON that `rootform run` writes is a
Rootform document, and its public contract is `contracts/rootform-document.md` in
rootform-dev/rootform. The Action metadata and README still describe the `architecture` and
`baseline-architecture` outputs and the uploaded artifacts with the retired name.

## Outcome

Action metadata and README name the saved JSON a Rootform document. Every input, output, file
name, artifact inventory, and runtime behavior stays unchanged.

## Non-goals

- Renaming the published `architecture`, `baseline-architecture`, or `diff-*` outputs.
- Changing installation, reporting, artifact names, or the pinned Rootform version.
- Rewriting historical specs and ADRs.

## Constitution impact

The CLI still owns every Rootform semantic; the Action only changes descriptive text. No
security, privacy, offline, or determinism property changes.

## Requirements

### REQ-001 — Rootform document wording

- Acceptance: WHEN a reader views the Action metadata or README THE SYSTEM SHALL describe the
  saved JSON as a Rootform document and SHALL NOT use the name "Architecture IR".
- Done when: `rg -n "Architecture IR" action.yml README.md` prints nothing and `bun run
  verify` passes.
- Evidence: `action.yml`, `README.md`

## Failure and boundary behavior

No runtime behavior changes. Output names and values are identical before and after.

## Determinism, completeness, and provenance

Unchanged; `dist/` is not affected.

## Security and privacy

Unchanged.

## Compatibility and delivery

Workflows that read the `architecture` or `baseline-architecture` outputs keep working.
Rollback restores the previous descriptions.

## Open questions

None.

## Acceptance record

Accepted by the owner directive recorded above.
