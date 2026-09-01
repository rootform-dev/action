# SPEC-003: Continuous integration dialect preparation

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-09-01 (explicit directive to make Rootform
  runnable in any CI with vendored dialects, a committed lock, or no lock at
  all, without duplicating Rootform resolution logic in the Action)
- Created: 2026-09-01
- Updated: 2026-09-01
- Related ADRs: ADR-002, ADR-004

## Problem

Rootform Action installs a pinned CLI and reports what that CLI said. It does
nothing about project dialects. A repository whose dialects are neither
vendored nor already present in a Rootform home therefore fails during
analysis, and the failure appears as an analysis error rather than as a
preparation outcome the caller can act on.

The CLI already owns resolution, acquisition, verification, and locking through
`rootform init`. It exposes that outcome as a machine-readable envelope and
accepts the exact execution modes a CI job needs. The Action can therefore
prepare a run faithfully by invoking the CLI once, before analysis, and
reporting its envelope.

A prepared run also repeats work on every job. Installed dialects and
content-addressed blobs are immutable once verified, so they can be restored
between runs. The official index is a mutable selection state and must never be
shared between two revisions of a pull request.

## Outcome

An Action run prepares its own Rootform environment before analyzing anything.
It isolates a Rootform home for the job, invokes `rootform init` once with the
caller's execution mode, reports the preparation outcome, exposes the resulting
lock, and offers an opt-out cache of immutable dialect payload. A first run in a
repository without a lock completes and tells the caller to commit the generated
lock; it never commits that file itself.

## Non-goals

- Reimplementing provider discovery, dialect selection, lock reading, dialect
  download, store management, policy evaluation, diff, or coverage in Node.
- Committing, pushing, or otherwise mutating repository content.
- Running `terraform init`, `tofu init`, or any plan command.
- Making `setup` prepare dialects. It installs and verifies a CLI, nothing more.
- Publishing an Action release, moving a tag, or changing repository visibility.
- Adding an authenticated dialect source. The Action passes no credential to
  the CLI.

## Constitution impact

- **I and II — CLI semantics and exit codes:** preparation reports the CLI
  envelope and its documented exit status. The Action reads the envelope for
  presentation and never recomputes a Rootform decision from it.
- **V — Least privilege:** preparation needs no token. The release credential
  and the pull-request credential stay out of the CLI environment.
- **VI — Determinism:** one preparation runs per job, before analysis, so every
  later command observes the same resolved dialect set.
- **VII — Data minimization:** the isolated home path is exported as an
  environment variable for later steps and is never published as an output, in
  a summary, or in an artifact.
- **VIII — Offline after install:** preparation is the only step allowed to
  acquire dialects, and `offline` removes even that.
- **XII — Published surface:** new inputs and outputs are additive. A caller
  who upgrades without changing configuration keeps existing behavior, plus
  preparation.

## Requirements

### REQ-001 — Preparation happens once, through the CLI

- Acceptance: WHEN an analysis run starts THE SYSTEM SHALL invoke the Rootform
  CLI initialization command exactly once for the analyzed project, before any
  build, check, or diff command, and SHALL derive its reported preparation
  outcome only from that command's machine envelope and exit status.
- Done when: `bun test src/preparation.test.ts -t "builds one exact preparation command"`
  exits `0`.
- Evidence: `src/preparation.ts`, `src/preparation.test.ts`

### REQ-002 — Execution mode maps to exact CLI flags

- Acceptance: WHEN `locked` is enabled THE SYSTEM SHALL pass the CLI locked
  flag, WHEN `offline` is enabled THE SYSTEM SHALL pass the CLI offline flag,
  and THE SYSTEM SHALL always pass the CLI no-input flag so no run can wait for
  a prompt.
- Done when: `bun test src/preparation.test.ts -t "maps execution modes to CLI flags"`
  exits `0`.
- Evidence: `src/preparation.ts`, `src/preparation.test.ts`

### REQ-003 — Rootform home is isolated per job and never published

- Acceptance: WHEN a run prepares its environment THE SYSTEM SHALL place the
  Rootform home under the runner temporary directory, export it as an
  environment variable for later steps, and SHALL NOT expose that absolute path
  as an action output, in the Job Summary, or in an uploaded artifact.
- Done when: `bun test src/main.test.ts -t "isolates the Rootform home without publishing its path"`
  exits `0`.
- Evidence: `src/main.ts`, `src/main.test.ts`

### REQ-004 — A generated lock is surfaced, never committed

- Acceptance: WHEN preparation writes a project lock THE SYSTEM SHALL expose
  its workspace-relative path and a created flag as outputs, include the file in
  the uploaded artifact when artifact upload is enabled, state in the Job
  Summary that the lock was generated for this run and should be committed, and
  SHALL NOT stage, commit, or push it.
- Done when: `bun test src/main.test.ts -t "surfaces a generated lock without committing it"`
  exits `0`.
- Evidence: `src/main.ts`, `src/report.ts`, `src/main.test.ts`

### REQ-005 — Preparation failure stops the job with the CLI diagnostic

- Acceptance: WHEN the initialization command exits non-zero THE SYSTEM SHALL
  fail the job with the CLI diagnostic, SHALL NOT run any analysis command, and
  SHALL NOT rewrite or delete the project lock.
- Done when: `bun test src/preparation.test.ts -t "stops on a failed preparation"`
  exits `0`.
- Evidence: `src/preparation.ts`, `src/preparation.test.ts`

### REQ-006 — Cache restores immutable payload only

- Acceptance: WHEN caching is enabled THE SYSTEM SHALL restore and save only
  installed dialects and content-addressed blobs, SHALL NOT cache the official
  index or any other mutable selection state, and SHALL derive its key from the
  project lock digest when a lock exists rather than from provider names.
- Done when: `bun test src/cache.test.ts -t "caches only immutable dialect payload"`
  exits `0`.
- Evidence: `src/cache.ts`, `src/cache.test.ts`

### REQ-007 — A restored cache is never a source of truth

- Acceptance: WHEN a cache entry is restored THE SYSTEM SHALL still run the
  full initialization command so the CLI verifies every dialect by digest, and
  SHALL NOT skip, shorten, or bypass preparation because a cache hit occurred.
- Done when: `bun test src/cache.test.ts -t "never lets a restored entry replace verification"`
  exits `0`.
- Evidence: `src/cache.ts`, `src/main.ts`, `src/cache.test.ts`

### REQ-008 — Preparation receives no credential

- Acceptance: WHEN the initialization command runs THE SYSTEM SHALL execute it
  with the same credential-stripped environment used for every other CLI
  command, so no release token and no pull-request token reaches the CLI.
- Done when: `bun test src/network-boundary.test.ts -t "keeps credentials out of preparation"`
  exits `0`.
- Evidence: `src/preparation.ts`, `src/network-boundary.test.ts`

### REQ-009 — Reports stay free of runner paths and raw material

- Acceptance: WHEN preparation contributes to the Job Summary THE SYSTEM SHALL
  publish dialect names, versions, and the caller-facing lock state only, and
  SHALL NOT publish an absolute path, an environment value, raw Terraform
  material, or a credential.
- Done when: `bun test src/report.test.ts -t "renders preparation without runner paths"`
  exits `0`.
- Evidence: `src/report.ts`, `src/report.test.ts`

### REQ-010 — Setup stays an installer

- Acceptance: WHEN the setup entrypoint runs THE SYSTEM SHALL install and
  verify a Rootform CLI and add it to the path, and SHALL NOT resolve, acquire,
  or lock any dialect.
- Done when: `bun test src/entrypoints.test.ts -t "setup never prepares dialects"`
  exits `0`.
- Evidence: `src/setup.ts`, `src/entrypoints.test.ts`

### REQ-011 — Complete repository proof

- Acceptance: WHEN the change is complete THE SYSTEM SHALL pass the full
  repository gate including the rebuilt committed bundle.
- Done when: `bun run verify` exits `0`.
- Evidence: local gate transcript recorded in `specs/003-ci-dialect-preparation/tasks.md`
