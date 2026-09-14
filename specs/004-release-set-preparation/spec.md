# SPEC-004: Release-set project preparation

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-09-14 (explicit RF Language and
  Architecture IR v0.1 replacement directive)
- Created: 2026-09-14
- Updated: 2026-09-14
- Related ADR: ADR-005

## Problem

Rootform now ships RF Vocabulary and supplied Dialects inside one immutable
release set. The Action still describes provider discovery, separately
installed supplied Dialects, generated locks, and an official Dialect index.
Those behaviors no longer exist. They also cause the Action to cache and report
the wrong state.

## Outcome

The Action remains a thin CLI host. Before analysis it invokes `rootform init`
once to verify or acquire only exact non-embedded selections already recorded
in `rootform.lock`: Dialects and Policy Pack sources. A missing lock
is an empty selection unless `locked` is enabled. Preparation never writes a
lock, resolves providers, or acquires supplied Dialects.

## Non-goals

- Parsing a lock, Terraform, RF, or Architecture IR in the Action.
- Selecting, upgrading, or publishing any semantic unit.
- Caching supplied Dialects, RF Vocabulary, linked artifacts, or mutable state.
- Changing Rootform analysis, diff, policy, renderer, or installer semantics.
- Publishing an Action release or moving a tag.

## Requirements

### REQ-001 — Exact CLI preparation

- Acceptance: WHEN the main entrypoint prepares a project THE SYSTEM SHALL run
  `rootform init` on the workspace path with `--format json --no-input`
  exactly once before analysis, map `locked` and `offline` inputs to their
  same-named CLI flags, and SHALL treat any non-zero exit as a preparation
  failure without fallback.
- Done when: `bun test src/preparation.test.ts -t "builds one exact
  preparation command"` exits `0`.
- Evidence: `src/preparation.ts`, `src/preparation.test.ts`

### REQ-002 — Machine envelope

- Acceptance: WHEN the CLI returns an initialization envelope THE SYSTEM SHALL
  accept only format version `1` with `prepared: true`, bounded Dialect and
  Policy Pack unit arrays, non-negative downloaded bytes, and units carrying
  only the closed `verified` or `acquired` status, and SHALL report those
  fields without deriving another Rootform decision.
- Done when: `bun test src/preparation.test.ts -t "reports exact prepared
  external units without reinterpreting them"` exits `0`.
- Evidence: `src/preparation.ts`, `src/preparation.test.ts`

### REQ-003 — Lock ownership

- Acceptance: WHEN a project lock exists THE SYSTEM SHALL expose its
  workspace-relative `lock-path`, and WHEN no lock exists THE SYSTEM SHALL
  neither create, copy, upload, stage, commit, nor claim to generate
  `rootform.lock`; `locked` SHALL require that file through CLI behavior.
- Done when: `bun test src/main.test.ts -t "reports an existing lock without
  uploading or mutating it"` exits `0`.
- Evidence: `src/main.ts`, `src/main.test.ts`

### REQ-004 — Immutable external-package cache

- Acceptance: WHEN cache is enabled THE SYSTEM SHALL persist only installed
  Rootform-home `dialects/` and `policy-packs/` directories, SHALL exclude
  supplied semantics, temporary content, linked artifacts, and discovery state,
  SHALL bind cache keys to exact Rootform version, execution mode, platform,
  and lock digest when present, and SHALL run preparation with CLI verification
  after every restore.
- Done when: `bun test src/cache.test.ts` exits `0`.
- Evidence: `src/cache.ts`, `src/cache.test.ts`

### REQ-005 — Honest public surface and report

- Acceptance: WHEN the main entrypoint completes THE SYSTEM SHALL expose
  `preparation-mode` and remove `resolution-mode` and `lock-created`, and
  SHALL report only preparation mode, exact Dialects, exact Policy Packs,
  downloaded bytes, and the existing lock path without any provider coverage
  or supplied-Dialect installation claim.
- Done when: `bun test src/report.test.ts -t "renders preparation without
  runner paths"` exits `0`.
- Evidence: `src/main.ts`, `src/main.test.ts`, `src/report.ts`,
  `src/report.test.ts`, `action.yml`

### REQ-006 — Isolation, credentials, and network

- Acceptance: WHEN the run prepares or analyzes a project THE SYSTEM SHALL keep
  the Rootform home isolated under runner temporary storage and absent from
  outputs, reports, and artifacts, SHALL pass the credential-stripped CLI
  environment to preparation, and SHALL keep analysis commands offline while
  only explicit preparation acquires exact OCI pins already present in lock.
- Done when: `bun test src/network-boundary.test.ts` exits `0`.
- Evidence: `src/network-boundary.test.ts`, `src/preparation.ts`

### REQ-007 — Complete proof

- Acceptance: WHEN change is proposed complete THE SYSTEM SHALL pass format,
  type, unit, bundle-sync, action metadata, workflow, secret working-set, and
  full-history checks.
- Done when: `bun run verify` exits `0`.
- Evidence: repository gate output
