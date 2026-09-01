# SPEC-003 tasks

## T001 — Preparation command and envelope

- Status: Completed
- Owner: primary agent
- Scope: `src/preparation.ts`, `src/preparation.test.ts`
- Depends on: None
- Requirements: REQ-001, REQ-002, REQ-005, REQ-008
- Done when: `bun test src/preparation.test.ts src/network-boundary.test.ts` exits `0`.
- Expected evidence: exact command, flag matrix, envelope reading, failure propagation
- Evidence recorded: 2026-09-01 — preparation and network-boundary suites
  passed; the initialization command is built once per run, execution modes map
  to exact CLI flags, no-input is always present, a non-zero exit propagates the
  CLI diagnostic, and the command environment carries neither token.

## T002 — Immutable dialect cache

- Status: Completed
- Owner: primary agent
- Scope: `src/cache.ts`, `src/cache.test.ts`
- Depends on: T001
- Requirements: REQ-006, REQ-007
- Done when: `bun test src/cache.test.ts` exits `0`.
- Expected evidence: locked and unlocked key derivation, excluded index path
- Evidence recorded: 2026-09-01 — cache suite passed; only installed dialects
  and content-addressed blobs are cached, the official index is excluded, a
  locked key includes the lock digest, an unlocked key stays coarse with
  restore prefixes, and no key is derived from a provider name.

## T003 — Orchestration, outputs, and report

- Status: Completed
- Owner: primary agent
- Scope: `src/main.ts`, `src/report.ts`, `action.yml`, `README.md`, generated `dist/`
- Depends on: T001, T002
- Requirements: REQ-003, REQ-004, REQ-009, REQ-010
- Done when: `bun test src/main.test.ts src/report.test.ts src/entrypoints.test.ts && bun run build && bun run verify:dist` exits `0`.
- Expected evidence: exported home variable, additive outputs, artifact inventory, setup boundary
- Evidence recorded: 2026-09-01 — main, report, and entrypoint suites passed;
  the Rootform home is isolated under the runner temporary directory and
  exported without being published, a generated lock is exposed and uploaded
  without being committed, the summary states the commit recommendation without
  any runner path, and setup still installs only.

## T004 — Complete repository proof

- Status: Completed
- Owner: primary agent
- Scope: repository gate
- Depends on: T001, T002, T003
- Requirements: REQ-011
- Done when: `bun run verify` exits `0`.
- Expected evidence: full local gate transcript
- Evidence recorded: 2026-09-01 — full gate passed, including foundation
  policy, typecheck, format, tooling and runtime suites, workflow static
  analysis, secret scans, and the rebuilt committed bundle.
