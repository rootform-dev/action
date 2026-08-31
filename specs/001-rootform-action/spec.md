# SPEC-001: Verified Rootform GitHub Action

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-08-30 (explicit directive to implement
  `rootform-dev/action@v1` and `rootform-dev/action/setup@v1` against releases
  from `rootform-dev/rootform`, with source/plan execution, summaries, artifacts,
  and CI gating)
- Amendment approval: @soulbah — 2026-08-31 (Action consumes published
  Rootform releases only and rejects drafts regardless of authentication)
- Created: 2026-08-30
- Amended: 2026-08-31
- Related ADR: ADR-002

## Problem

Repository contains governance and release automation but no Action metadata,
runtime source, bundle, installer, or integration behavior. Users cannot install
a verified Rootform CLI or publish its unattended output.

During migration, releases remain private. GitHub's workflow token is scoped to
repository containing workflow, so private cross-repository tests need an
optional read credential. Future public releases must install without account,
token, entitlement, or private API contract.

## Outcome

Two JavaScript Action entrypoints share one verified installer. Setup adds an
exact Rootform binary to `PATH`. Main entrypoint builds source or plan input,
evaluates policies, writes deterministic JSON, HTML, and SARIF files, appends
CLI-produced Markdown to Job Summary, uploads one artifact, and gates only on
documented CLI exit status.

## Non-goals

- Parsing Terraform, plans, Architecture IR, policy JSON, SARIF, or HTML inside
  Action to derive semantic meaning.
- Diff/change gating, PR comments, check runs, annotations, autofix, caching
  dialects, installing dialects, or fetching provider data.
- Marketplace publication, public release, moving major tags, Homebrew, package
  publication, or repository visibility change.
- Supporting GHES before official artifact client supports it.

## Requirements

### REQ-001 — Setup resolves and verifies one exact release

- Acceptance: WHEN caller requests exact version or `latest` THE SYSTEM SHALL
  resolve one published `rootform-dev/rootform` release, select exact runner
  asset, verify GitHub asset digest when present and matching `SHA256SUMS`, then
  add binary to `PATH` only after all checks pass.
- Done when: `bun test src/install.test.ts` exits `0`.
- Evidence: `src/install.ts`, `src/install.test.ts`

### REQ-002 — Private published-release token stays optional

- Acceptance: WHEN caller resolves a Rootform release THE SYSTEM SHALL accept an
  optional read token only for a private published release, reject every draft
  regardless of token presence, and install a public published release without
  token or account.
- Done when: `bun test src/github.test.ts` exits `0`.
- Evidence: `src/github.ts`, `src/github.test.ts`

### REQ-003 — Both entrypoints use one installer

- Acceptance: WHEN setup or main entrypoint installs Rootform THE SYSTEM SHALL
  call same installer and cache layout, with no second download or verification
  implementation.
- Done when: `bun test src/entrypoints.test.ts` exits `0`.
- Evidence: `src/setup.ts`, `src/main.ts`, `src/install.ts`

### REQ-004 — Source and plan modes preserve CLI ownership

- Acceptance: WHEN mode is `source` THE SYSTEM SHALL pass configured path as
  source input, and WHEN mode is `plan` THE SYSTEM SHALL pass it through CLI
  `--plan`, producing architecture JSON, self-contained HTML, policy JSON,
  policy SARIF, and policy Markdown without parsing outputs for semantics.
- Done when: `bun test src/run.test.ts` exits `0`.
- Evidence: `src/run.ts`, `src/run.test.ts`

### REQ-005 — CLI exit codes decide gate

- Acceptance: WHEN policy command exits `0`, `1`, `2`, or `3` THE SYSTEM SHALL
  preserve exact code as output, fail only according to documented invalid,
  indeterminate, or configured violation behavior, and SHALL never synthesize
  verdict from artifact content.
- Done when: `bun test src/run.test.ts -t exit` exits `0`.
- Evidence: `src/run.ts`, `src/run.test.ts`

### REQ-006 — Summary and artifacts minimize data

- Acceptance: WHEN run completes THE SYSTEM SHALL append CLI Markdown result to
  Job Summary, upload only named JSON/HTML/SARIF result files, expose only
  workspace-relative paths and artifact identity, and SHALL not log raw machine
  documents, token, environment, or absolute runner path.
- Done when: `bun test src/main.test.ts` exits `0`.
- Evidence: `src/main.ts`, `src/main.test.ts`

### REQ-007 — Runtime is offline after installation

- Acceptance: WHEN binary installation completes THE SYSTEM SHALL perform no
  further network operation except GitHub artifact upload explicitly enabled by
  caller.
- Done when: `bun test src/network-boundary.test.ts` exits `0`.
- Evidence: `src/install.ts`, `src/main.ts`, `src/network-boundary.test.ts`

### REQ-008 — Bundle and metadata are reproducible

- Acceptance: WHEN source is bundled twice with pinned toolchain THE SYSTEM SHALL
  produce identical committed `dist/` bytes, and both action manifests
  SHALL name Node 24 and existing bundles.
- Done when: `bun run build && bun run build && bun run verify:dist` exits `0`.
- Evidence: `action.yml`, `setup/action.yml`, `dist/`, `scripts/build.ts`

### REQ-009 — Complete repository gate

- Acceptance: WHEN change is proposed complete THE SYSTEM SHALL pass format,
  type, unit, bundle-sync, action metadata, workflow, secret working-set, and
  full-history checks.
- Done when: `bun run verify` exits `0`.
- Evidence: repository gate output

## Failure and privacy behavior

Unsupported runner, unavailable or draft release, missing asset, malformed
checksum, digest mismatch, extraction failure, binary version mismatch, invalid
input, CLI indeterminate result, or artifact upload failure stops Action
explicitly. Partially verified executable never reaches `PATH`.

Raw Terraform, plan content, tokens, absolute runner paths, environment values,
and machine documents never enter logs, outputs, or Job Summary. CLI owns
sanitization of its Markdown result; Action relays it without interpretation.

## Acceptance record

Owner directive approves exact bounded outcome and public surface above.
Implementation may proceed. Repository remains private and no major tag is
published during this task. Owner amendment on 2026-08-31 removes authenticated
draft consumption; private transition tests use a published prerelease.
