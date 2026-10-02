# SPEC-006: GitHub-native Rootform Actions

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-10-02 (explicit end-to-end redesign directive; public contract, research-led decisions, autonomous primitives, implementation and real public GitHub qualification)
- Created: 2026-10-02
- Related ADR: ADR-006

## Outcome

Six Node 24 entrypoints share one verified installer, project preparation,
execution and reporting implementation. The root entrypoint presents one input
or comparison and optionally evaluates selected Policies. Primitives remain
independently runnable. Rootform alone validates inputs, produces Forms and
reports, compares architectures, evaluates Policies and assigns exit codes.

This replaces the active behavior of SPEC-001 through SPEC-005 and ADR-002
through ADR-005. Those documents record historical decisions, not a compatibility
layer. No Terraform/OpenTofu execution, planning, configuration input mode,
cloud/provider/backend credential, semantic JSON parser or implicit Policy
selection is introduced.

## Requirements

### REQ-001 — Autonomous shared entrypoints

- Acceptance: WHEN any entrypoint runs THE SYSTEM SHALL use one installer and common runtime; setup and init SHALL remain optional for business actions.
- Done when: `bun test src/entrypoints.test.ts src/main.test.ts` proves independent entrypoints and repeated-step reuse.
- Evidence: `src/entrypoints.test.ts`, `src/main.test.ts`, six manifests and committed bundles.

### REQ-002 — Exact published verified installation

- Acceptance: WHEN installing or reusing Rootform THE SYSTEM SHALL require an exact version, verify published archive checksums and available API digests, bind executable bytes to the verified release manifest, check version before PATH publication, and reject drafts, mutable releases and unsupported targets.
- Done when: `bun test src/install.test.ts src/github.test.ts` proves corruption, cached tampering, unsupported runners and public published prereleases.
- Evidence: installer tests and `evidence/qualification.md`.

### REQ-003 — Analyze, compare and preserve Forms

- Acceptance: WHEN analyzing a plan/state or reopening a Form THE SYSTEM SHALL request its Markdown and HTML together; WHEN comparing THE SYSTEM SHALL accept plan/state/single-input Form operands with applicable saved plans and selected stages, preserve CLI refusal of comparison operands, and expose only the resulting Form path.
- Done when: `bun test src/run.test.ts` plus published-binary e2e prove mixed operands, reopens, saved plan pairing and multi-output.
- Evidence: runtime tests and `evidence/qualification.md`.

### REQ-004 — Check without preceding analyze

- Acceptance: WHEN checking a plan/state THE SYSTEM SHALL produce one Form before one multi-output check; WHEN checking a saved Form/comparison THE SYSTEM SHALL reuse it without compilation and pass Policy selection, side and stage to the CLI.
- Done when: `bun test src/run.test.ts src/main.test.ts` and published-binary e2e exercise direct input, saved comparison, both sides, negative and undecided outcomes.
- Evidence: runtime tests and `evidence/qualification.md`.

### REQ-005 — Evidence precedes gate

- Acceptance: WHEN Rootform returns a negative or undecided verdict THE SYSTEM SHALL expose available file paths and exact check exit, publish requested artifacts, Summary and eligible comment before failing; no fail-on option SHALL reinterpret an exit.
- Done when: `bun test src/main.test.ts` proves event ordering for exits 0 through 4, publication failures and retained partial evidence.
- Evidence: orchestration tests and public negative consumer runs.

### REQ-006 — Four distinct output channels

- Acceptance: WHEN a Form is owned or produced THE SYSTEM SHALL expose its reusable same-job path without file content, upload only explicit derived files when enabled, present CLI Markdown in Summary, and reserve opt-in PR commenting for root entrypoint.
- Done when: `bun test src/main.test.ts src/report.test.ts` proves Form paths, artifact allowlist, disabled publication, oversize reports and exact Markdown forwarding.
- Evidence: runtime tests and downloaded public artifacts.

### REQ-007 — Safe current single PR report

- Acceptance: WHEN root comment is enabled THE SYSTEM SHALL upsert one marker-owned bot comment only for an eligible same-repository pull_request, check current HEAD/run/attempt, refuse stale writes, and require native job serialization for concurrent writers; fork and privileged target events SHALL never write.
- Done when: `bun test src/pull-request.test.ts` and public consumer protocol prove create/update, stale HEAD/run/attempt, duplicate prevention, fork/target safety and serialization.
- Evidence: comment tests, README concurrency contract and `evidence/qualification.md`.

### REQ-008 — Preparation and bounded cache

- Acceptance: WHEN raw evidence or Policy selection needs project content THE SYSTEM SHALL prepare through rootform init, preserve the lock, map locked/offline only where meaningful, share ROOTFORM_HOME within the job, and cache only exact external source payload whose CLI verification always follows restore.
- Done when: `bun test src/preparation.test.ts src/cache.test.ts src/main.test.ts` plus real locked/offline/external-content qualification pass.
- Evidence: preparation/cache tests and public consumer proof.

### REQ-009 — Minimal security and public contract

- Acceptance: WHEN any CLI process runs THE SYSTEM SHALL exclude GitHub/Actions tokens, avoid shell interpolation, execute no infrastructure tool, and keep raw inputs out of logs/artifacts; docs SHALL lead with root Action then advanced primitives and explain exact pins, permissions, fork safety, retention and matrix collisions.
- Done when: `bun test src/environment.test.ts src/entrypoints.test.ts` and final lead source/docs review find no active legacy command or forbidden input upload.
- Evidence: security tests, README, ADR-006 and final review record.

### REQ-010 — Complete actual public qualification

- Acceptance: WHEN delivered THE SYSTEM SHALL pass unit tests, real published-binary integration, deterministic Node-only bundles, full repository gate and public external consumer workflows before primary review and merge.
- Done when: `bun run verify` and bounded public consumer protocol record exact Action SHA, CLI release/digests, run/PR/comment/artifact identities and outcomes in `evidence/qualification.md`.
- Evidence: repository gate and qualification record.

## Compatibility and ownership

No aliases preserve withdrawn input/output names. Action consumes only published
Rootform releases; no private source or local rebuilt executable qualifies a
consumer. Exact CLI pins are distinct from Action Git refs. Public workflow
qualification uses synthetic data only. The owner authorizes this replacement
surface; release refs may first be created only after reviewed green merged
source. No existing tag is moved by this change.

## Complete review clarification

- Owner approval: @soulbah — 2026-10-02.
- GitHub Actions request `--details` for every Markdown-producing run/check.
  Full reports remain in step outputs and enabled artifacts; long lists use
  disclosure rather than a CLI preview instruction in GitHub.
- Review composition preserves CLI statements, tables and recorded verdicts,
  uses one H2 identity, H3 blocks and H4 subsections, and separates major blocks.
  It does not derive conclusions from Form or Policy JSON.
- Inline size limits may omit secondary/exhaustive detail, with an explicit
  complete-report link, while retaining CLI-written primary summaries and
  verdicts. File outputs and artifacts always retain the complete report.
