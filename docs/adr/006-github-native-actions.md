# ADR-006: GitHub-native Actions and current Rootform contract

- Status: Accepted
- Date: 2026-10-02
- Owner: @soulbah
- Owner approval: @soulbah — 2026-10-02 (complete public Action redesign and delegated research; architecture and final validation owned by lead)
- Related spec: SPEC-006
- Supersedes: ADR-002 through ADR-005 for active runtime behavior

## Findings

Current published Rootform consumes plan/state exports and saved Forms. Its
single `run` command also compares operands using `--diff`; there is no
standalone CLI comparison command. Repeatable `-o` renders all outputs after
one analysis. Saved Forms load without compilation. Comparison Forms reopen
alone and cannot be operands. `check` produces all reports for verdicts 0/1/3;
architectural differences alone leave `run` at zero. `init` prepares exact
external lock selections, preserves the lock and never runs an infrastructure
tool. These facts were checked against published `0.1.0-pr.117.1` and its
public CLI source and reference docs.

Recognized integrations support different tradeoffs. Infracost offers setup
and integrated diff; Pulumi combines installation, command execution and
optional comments/Summary; setup-terraform is an installation primitive;
Vault transports remote credentials; golangci-lint combines install/lint/cache;
Checkov exposes many scan/failure/platform settings. Their mutable version
selectors, credentials and infrastructure execution do not fit Rootform.
An inventory of documentation is not a claim that their entire implementations
were audited. The retained design below is a lead decision, not delegated
architecture.

## Decision

- Root plus setup/init/analyze/compare/check share one implementation and
  generated Node 24 bundles. Setup installs only; init prepares only. Every
  business action installs/prepares what it needs independently.
- `version` accepts exact published semantic versions, including explicit
  prereleases. No latest/range resolution. A verified earlier Action step
  exports the exact version for reuse when later steps omit it. Bare ambient
  PATH executables never become trusted by reporting a version alone.
- Installation requires published immutable release, checksum/API-digest
  verification, manifest-bound executable hash, then exact version. Existing
  matching verified bytes avoid archive download. Cached tampering fails before
  execution. No compiler build-attestation claim is invented from release
  digests; the current candidate has no such attestation.
- `input` accepts plan/state/Form; `before` and `after` identify two comparison
  operands. CLI remains final classifier/validator. Transport may inspect only
  generator/kind to choose the saved-Form path; no architecture, Policy result,
  count or verdict is parsed in JavaScript.
- Analyze requests Markdown/HTML and a new Form together for raw evidence;
  saved Forms keep their original path/bytes. Compare exports one Comparison
  Form/Markdown/HTML; before/after Forms remain internal if normalization is
  necessary. Check raw evidence first produces one Form, then one check writes
  JSON/Markdown/SARIF; saved Forms are validated/reused without compilation.
- `plan-file` and comparison-side saved plans supply actual optional evidence.
  When provided, pairing is required so an explicitly supplied mismatched saved
  plan cannot silently degrade. Stage/side inputs express real user selection.
  No arbitrary CLI args, producer claims, provider maps or enrichment toggles
  are added without demonstrated demand.
- Root infers analyze versus compare from files supplied. Policy selectors or
  overlays request checking; `check: true` also checks all lock-selected packs.
  Analysis alone makes no Policy claim. No implicit official Policy Pack is
  selected. Root report combines exact CLI reports with section framing only.
- Root owns opt-in PR comment. All business actions publish Summary by default
  and produce Markdown regardless of Summary setting. Comment uses the same
  optional GitHub token used for release API rate limits; it never reaches CLI.
  No separate release/comment token, comment key, custom check or auto SARIF
  ingestion is needed. Public installation works anonymously.
- Outputs are file paths for same-job reuse. Absolute temporary paths are
  permitted there; file bodies, home, tokens and raw inputs are not. Artifacts
  contain only an explicit derived-file inventory, including valid Form, under
  stable basenames. Upload is enabled by default, disable with one toggle;
  retention defaults to seven days. Default artifact names avoid step/matrix
  collision; callers can supply a stable artifact-name. Cross-job reuse uses
  artifact IDs or caller-chosen names, never a runner path.
- Evidence publication finishes before applying the exact nonzero CLI gate.
  GitHub continue-on-error controls caller workflow continuation; no fail-on
  knobs reinterpret Rootform. Publication failure is explicit, while other
  available evidence channels are still attempted.
- Project/locked/offline/cache govern raw analysis or Policy source selection.
  Saved analyze/compare do not prepare Dialects. Locked mixed comparison first
  normalizes raw operands with their exact selection, then compares saved Forms,
  because CLI correctly refuses acquisition flags on a saved operand.
- ROOTFORM_HOME uses a stable name under job-isolated RUNNER_TEMP, is created
  once per job and exported, or an explicit caller
  home is reused. Random home names would change the official cache client
  cache-version hash and prevent cross-job restoration. Cache contains installed external Dialects/Policy Pack
  sources only; no Forms, reports, linked artifacts, credentials or discovery
  state. Skip remote cache entirely without project lock. Restore is an
  untrusted optimization followed by actual CLI digest verification. Keys bind
  exact version/platform/lock bytes, not execution mode, so online preparation
  can warm a later offline run. No other lock is restored through coarse keys.

## Comment concurrency and trust

Only same-repository pull_request may write. Forks and pull_request_target keep
local evidence and perform no write. Commenting requires pull-requests: write
and actions: read for current run verification; normal usage needs contents:
read. One bot-owned marker identifies the comment. Current HEAD, current run
attempt and newer relevant run/comment metadata are checked before writes.
One root reporter per PR uses a native job concurrency group shared across
all reporting workflows, with cancel-in-progress false. This serialization is
part of the opt-in comment contract; it prevents concurrent create/update
races. GitHub does not support conditional unsafe REST mutations for comments,
so check-then-PATCH alone cannot provide an atomic guarantee. Do not pretend
otherwise or add a second comment/lock API.

Summary and comment carry CLI Markdown plus run/version/evidence links. Markdown
outputs always request `--details`; complete files stay available even when
GitHub's inline limit requires omitting exhaustive disclosure contents. Primary
CLI summaries and verdicts remain visible when they fit, with a complete-report
link. No conclusions or counts are reconstructed from JSON.

## Versioned Action refs

All six paths share the same Git reference. Immutable commit pins remain the
reproducible/security recommendation. ADR-007 replaces the original
`publish-v1.yml` bootstrap: `v1` names the newest published, qualified
`v1.x.y` release and moves only forward, inside the owner-dispatched release
run. Version tags never move.

## Sources

- https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/rest/issues/comments
- https://github.com/actions/toolkit/blob/main/packages/artifact/README.md
- https://github.com/infracost/actions/blob/master/setup/README.md
- https://github.com/infracost/actions/blob/master/diff/README.md
- https://github.com/pulumi/actions/blob/main/README.md
- https://github.com/hashicorp/setup-terraform/blob/main/action.yml
- https://github.com/hashicorp/vault-action/blob/main/action.yml
- https://github.com/golangci/golangci-lint-action/blob/main/README.md
- https://github.com/bridgecrewio/checkov-action/blob/master/action.yml
- https://github.com/rootform-dev/rootform/blob/v0.1.0-pr.117.1/docs/reference/cli/run.md
- https://github.com/rootform-dev/rootform/blob/v0.1.0-pr.117.1/docs/reference/cli/check.md

## Compatibility, scope and reversal

The old source/configuration and multi-pass execution surface is replaced
without aliases. Historical specs/ADRs retain their evidence with an explicit
supersession notice. No Rootform/Engine/Web change is needed. Rollback pins
consumers to previous reviewed commit rather than rewriting a published tag.
Toolchain stays Bun-only. Existing core/tool-cache/artifact versions remain
latest stable; cache adopts 6.3.0, discovered from official npm registry.
Node 24 remains runtime, requiring Actions Runner 2.327.1 or newer. Local
bundle smoke uses a verified Node 24 release rather than host Node 23.
