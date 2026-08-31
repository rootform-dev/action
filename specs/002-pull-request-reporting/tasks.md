# SPEC-002 tasks

## T001 — CLI and path boundary

- Status: Completed
- Owner: primary agent
- Scope: `src/diff.ts`, `src/run.ts`, tests
- Depends on: None
- Requirements: REQ-001, REQ-002, REQ-007, REQ-008
- Done when: `bun test src/diff.test.ts src/run.test.ts src/network-boundary.test.ts` exits `0`.
- Expected evidence: exact command and environment assertions
- Evidence recorded: 2026-08-31 — 10 focused tests passed; source and plan
  commands, project working directories, exit mapping, token isolation, and
  unsafe path rejection are asserted.

## T002 — GitHub-native report

- Status: Completed
- Owner: primary agent
- Scope: `src/report.ts`, `src/pull-request.ts`, tests
- Depends on: T001
- Requirements: REQ-003, REQ-004, REQ-005
- Done when: `bun test src/report.test.ts src/pull-request.test.ts` exits `0`.
- Expected evidence: deterministic Markdown and API fixtures
- Evidence recorded: 2026-08-31 — 8 focused tests passed; deterministic
  summary/comment rendering, 60,000-byte fallback, event validation, fork
  boundary, create/update, and duplicate-marker failure are asserted.

## T003 — Action orchestration and bundle

- Status: Completed
- Owner: primary agent
- Scope: `src/main.ts`, `action.yml`, `README.md`, generated `dist/`
- Depends on: T001, T002
- Requirements: REQ-006, REQ-007, REQ-008, REQ-010
- Done when: `bun test src/main.test.ts src/entrypoints.test.ts && bun run build && bun run verify:dist` exits `0`.
- Expected evidence: allow-listed artifacts, additive outputs, synced bundle
- Evidence recorded: 2026-08-31 — main and entrypoint suites passed; source
  reporting uploads the exact eight-file inventory, legacy mode retains four
  files, and deterministic Node bundles passed `bun run verify:dist`.

## T004 — Real pull-request proof

- Status: In progress
- Owner: primary agent
- Scope: synthetic fixture, private GitHub PR, evidence record
- Depends on: T003
- Requirements: REQ-009
- Done when: real changed and unchanged runs update one comment and preserve downloadable evidence.
- Expected evidence: PR, run, comment, artifact, annotation, and screenshots
- Evidence recorded: Pending

## T005 — Complete verification

- Status: Not started
- Owner: primary agent
- Scope: final diff and repository gates
- Depends on: T004
- Requirements: REQ-011
- Done when: `bun run verify` exits `0` locally and in GitHub Actions.
- Expected evidence: final gate output and clean worktree
- Evidence recorded: Pending

## Final review

- [ ] Every accepted requirement maps to at least one completed task.
- [ ] `bun run verify` exits `0`.
- [ ] Diff has no unrelated edit, private material, secret, generated noise, or unexplained dependency change.
- [ ] Primary reviewer records limitations and owns completion claim.
