# SPEC-001 tasks

## T001 — Installer contract

- Status: Completed
- Requirements: REQ-001, REQ-002, REQ-003
- Done when: installer and entrypoint unit tests pass.

## T002 — Execution and artifacts

- Status: Completed
- Requirements: REQ-004, REQ-005, REQ-006, REQ-007
- Done when: source/plan, gate, summary, artifact, and network tests pass.

## T003 — Bundle and complete proof

- Status: In progress
- Requirements: REQ-008, REQ-009
- Done when: deterministic bundle sync and `bun run verify` pass.

## T004 — Published-release boundary

- Status: In progress
- Requirements: REQ-001, REQ-002
- Done when: exact private published prerelease succeeds, draft fails with or
  without token, bundle sync passes, and `bun run verify` exits `0`.
