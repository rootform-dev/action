# SPEC-002: Pull request architecture reporting

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-08-31 (explicit directive to implement
  pull-request diff reporting end to end without further proposal and return
  real GitHub evidence)
- Created: 2026-08-31
- Updated: 2026-08-31
- Related ADRs: ADR-002, ADR-003

## Problem

Rootform Action currently analyzes one Terraform source tree or plan, appends
the CLI policy Markdown to Job Summary, and uploads machine and HTML results.
It does not compare pull-request architecture, publish a pull-request comment,
or emit a concise GitHub annotation. Users therefore must open workflow logs
and artifacts to discover whether architecture changed and what Rootform
reported.

The published Rootform CLI already owns deterministic `diff` behavior for two
architectures and for Terraform plan JSON. Its Markdown and JSON formats, plus
its documented exit statuses, are sufficient for the Action to report changes
without parsing or re-deriving architecture semantics.

## Outcome

An opt-in Rootform Action run presents one current, public-safe architecture
review in GitHub: a structured Job Summary, one marker-owned pull-request
comment, one high-level annotation, and an allow-listed artifact containing
mode-appropriate architecture, diff, policy, and HTML evidence. The Action
relays CLI Markdown and documented exit statuses; it never computes semantic
change itself.

## Non-goals

- Fetching, cloning, or choosing the pull-request base revision. Caller checks
  out exact before and after inputs.
- Parsing Architecture IR, diff JSON, policy JSON, SARIF, Terraform source, or
  plan JSON to derive counts, labels, severity, or verdicts.
- Per-resource or per-line annotations, automatic SARIF upload, check-run
  creation, review approval, autofix, or repository mutation.
- `pull_request_target`, privileged fork execution, hidden network calls, or a
  required write token for analysis-only use.
- Installing or resolving project dialects. Projects provide exact locked or
  vendored dialects as required by the CLI.
- Publishing a Rootform or Action release, moving tags, or changing repository
  visibility during implementation and proof.

## Constitution impact

- **I and II — CLI semantics and exit codes:** every diff and policy statement
  comes from CLI Markdown or a documented CLI exit status. Presentation adds no
  semantic count or verdict derived from machine output.
- **V — Least privilege:** analysis needs `contents: read`. Pull-request writes
  are opt-in through a dedicated token and documented
  `pull-requests: write`; fork pull requests never receive a writer.
- **VI — Determinism:** report sections and artifact inventory use fixed order.
  Run, commit, and artifact links are explicit provenance, not semantic input.
- **VII — Data minimization:** reports exclude raw source, plans, machine JSON,
  absolute paths, environment values, and tokens.
- **VIII — Offline after install:** CLI execution remains offline. Only the
  already accepted artifact upload and new explicitly enabled comment upsert
  may use network access after installation.
- **XII — Published surface:** new inputs and outputs are additive and default
  to existing behavior.

## Requirements

### REQ-001 — CLI owns every reported architecture change

- Acceptance: WHEN change reporting is enabled in source mode THE SYSTEM SHALL
  invoke the Rootform CLI against an exact caller-supplied baseline project and
  current project, and WHEN enabled in plan mode THE SYSTEM SHALL invoke the
  CLI plan diff, producing CLI Markdown and JSON without interpreting either
  document.
- Done when: `bun test src/diff.test.ts -t "builds exact CLI diff plans"` exits
  `0`.
- Evidence: `src/diff.ts`, `src/diff.test.ts`

### REQ-002 — Source projects execute from their own roots

- Acceptance: WHEN source analysis runs THE SYSTEM SHALL execute `path` and
  `baseline-path` build and policy commands from each contained project root so
  its exact `rootform.lock` or `.rootform/dialects` is used,
  while rejecting absolute, escaping, file, and symbolic-link paths.
- Done when: `bun test src/run.test.ts -t "project roots"` exits `0`.
- Evidence: `src/run.ts`, `src/run.test.ts`

### REQ-003 — Job Summary answers review questions in stable order

- Acceptance: WHEN analysis completes THE SYSTEM SHALL append one Markdown
  report ordered as identity, gate outcomes, exact CLI diff Markdown, exact CLI
  policy Markdown, and evidence links; change and policy labels SHALL derive
  only from documented exit statuses.
- Done when: `bun test src/report.test.ts -t "renders deterministic summary"`
  exits `0`.
- Evidence: `src/report.ts`, `src/report.test.ts`

### REQ-004 — Pull-request comment is opt-in and updated in place

- Acceptance: WHEN an eligible pull request is reported THE SYSTEM SHALL create
  or update exactly one bot comment for a same-repository `pull_request` run
  supplying `pull-request-token`; the comment is identified by a stable hidden
  marker, and WHEN token is absent, event is not a pull request, or pull request
  comes from a fork THE SYSTEM SHALL perform no pull-request write and state the
  reason in Job Summary.
- Done when: `bun test src/pull-request.test.ts -t "upserts one safe report"`
  exits `0`.
- Evidence: `src/pull-request.ts`, `src/pull-request.test.ts`

### REQ-005 — Comment and summary remain bounded and useful

- Acceptance: WHEN exact CLI Markdown fits GitHub limits THE SYSTEM SHALL show
  it without semantic rewriting, and WHEN it exceeds a configured internal
  byte ceiling THE SYSTEM SHALL publish an explicit oversized-result state plus
  artifact and workflow links, never a silently truncated or partial diff.
- Done when: `bun test src/report.test.ts -t "bounds GitHub Markdown"` exits
  `0`.
- Evidence: `src/report.ts`, `src/report.test.ts`

### REQ-006 — Artifact preserves exact review evidence

- Acceptance: WHEN source change reporting is enabled THE SYSTEM SHALL upload
  only a fixed inventory containing current and baseline Architecture IR and
  HTML, CLI diff JSON and Markdown, plus existing policy JSON and SARIF; WHEN
  plan change reporting is enabled THE SYSTEM SHALL upload current Architecture
  IR and HTML, CLI diff JSON and Markdown, plus existing policy JSON and SARIF;
  outputs SHALL expose only workspace-relative paths, exact diff exit status,
  artifact ID, and artifact URL.
- Done when: `bun test src/main.test.ts -t "uploads pull request evidence"`
  exits `0`.
- Evidence: `src/main.ts`, `src/main.test.ts`

### REQ-007 — Gating and annotation use documented exits only

- Acceptance: WHEN CLI diff exits `0` or `1` THE SYSTEM SHALL expose that exact
  status, emit one high-level notice for unchanged or warning for changed, and
  fail on `1` only when `fail-on-changes` is true; exits `2`, `3`, or another
  value SHALL fail explicitly without a synthetic verdict.
- Done when: `bun test src/diff.test.ts src/main.test.ts -t "diff exit"` exits
  `0`.
- Evidence: `src/diff.ts`, `src/main.ts`, corresponding tests

### REQ-008 — Tokens never reach CLI or published evidence

- Acceptance: WHEN release or pull-request tokens are supplied THE SYSTEM SHALL
  use each only for its named GitHub operation, remove Action input token
  variables from every CLI child environment, redact them from failures, and
  exclude them from outputs, summaries, comments, artifacts, and logs.
- Done when: `bun test src/network-boundary.test.ts -t "isolates tokens"` exits
  `0`.
- Evidence: `src/run.ts`, `src/network-boundary.test.ts`

### REQ-009 — Real GitHub pull request proves complete UX

- Acceptance: WHEN synthetic Terraform changes are proposed THE SYSTEM SHALL
  run the branch Action with a published Rootform release on a real private
  same-repository pull request, update one
  comment across a changed and unchanged rerun, expose downloadable evidence,
  and leave no published release or tag.
- Done when: bounded manual protocol records pull-request, workflow-run,
  comment, artifact, and screenshot URLs in
  `specs/002-pull-request-reporting/evidence/e2e.md`.
- Evidence: private GitHub Actions run and public-safe screenshots referenced by
  the evidence record

### REQ-010 — Existing analysis remains compatible

- Acceptance: WHEN new inputs are omitted THE SYSTEM SHALL preserve SPEC-001
  command behavior, outputs, failure policy, and artifact inventory.
- Done when: `bun test src/entrypoints.test.ts src/main.test.ts src/run.test.ts`
  exits `0`.
- Evidence: existing regression suite plus new compatibility cases

### REQ-011 — Complete repository gate

- Acceptance: WHEN implementation is proposed complete THE SYSTEM SHALL pass
  format, types, unit tests, deterministic bundle sync, metadata validation,
  workflow validation, working-set secret scan, and full-history secret scan.
- Done when: `bun run verify` exits `0`.
- Evidence: local and GitHub quality-gate output

## Failure and boundary behavior

`report-diff=true` in source mode without `baseline-path`, unsafe project
paths, non-directory source projects, symlink traversal, invalid Boolean input,
inconsistent CLI output exits, malformed GitHub event identity, duplicate
marker-owned comments, comment API failure, artifact failure, and invalid CLI
diff exits fail with bounded diagnostics. Fork pull requests are expected
read-only runs: analysis, summary, and artifacts continue; comment is skipped.

No-changes is a successful diff status. Changes are successful unless
`fail-on-changes=true`. Policy gating remains controlled independently by
`fail-on-violations`.

## Determinism, completeness, and provenance

Report order and artifact names are fixed. Provenance includes exact Rootform
version, base and head commit identities when GitHub supplies them, workflow
run URL, artifact identity, source mode, and workspace-relative project paths.
The Action does not invent base identity: caller checkout and event metadata are
reported separately.

One report represents one complete CLI result. Oversized CLI Markdown is
replaced as a whole by an explicit link state; it is never sliced mid-table.

## Security and privacy

Raw Terraform, plan JSON, Architecture IR, diff JSON, policy JSON, SARIF,
tokens, environment values, and absolute runner paths never enter comments or
Job Summary. Machine documents remain in the allow-listed artifact only.

`pull-request-token` is separate from the optional private-release
`github-token`. Documentation grants `pull-requests: write` only to workflows
that opt into comments. No `pull_request_target` workflow is introduced.

## Compatibility and delivery

Existing callers receive identical behavior because `report-diff`,
`fail-on-changes`, and `pull-request-token` default to disabled or empty.
`baseline-path` is ignored unless source diff reporting is enabled. Node 24,
runner matrix, installer, release lookup, and published tag policy remain
unchanged.

Rollback removes additive inputs, outputs, diff files, PR writer, and report
framing. Existing SPEC-001 snapshot and policy behavior remains.

## Open questions

- Resolved by owner directive: additive inputs are `report-diff`,
  `baseline-path`, `fail-on-changes`, and `pull-request-token`.
- Resolved by owner directive: Action emits one overall annotation from CLI
  exit status; detailed SARIF upload remains an explicit caller-owned step.
- Resolved by owner directive: caller owns exact base checkout; Action performs
  no Git fetch or GitHub content download.

## Acceptance record

Accepted by @soulbah on 2026-08-31 through explicit instruction to implement
the bounded outcome and provide real pull-request proof without another design
approval round.
