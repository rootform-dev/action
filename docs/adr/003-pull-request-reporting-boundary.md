# ADR-003: Pull request reporting boundary

- Status: Accepted
- Date: 2026-08-31
- Owners: @soulbah
- Owner approval: @soulbah — 2026-08-31 (explicit directive to implement
  end-to-end pull-request UX and return real evidence without another proposal)
- Related spec: `specs/002-pull-request-reporting/spec.md`

## Context

SPEC-002 adds architecture diff presentation to a JavaScript Action that must
remain a thin host for Rootform CLI semantics. Wrong placement would either
make Action parse machine output, expose write credentials to fork code, fetch
an ambiguous base revision, or use `pull_request_target` while executing
untrusted pull-request content.

Verified GitHub behavior on 2026-08-31:

- issue-comment create and update endpoints accept a token with repository
  `Pull requests: write` permission;
- `pull_request` workflows from forks normally receive a read-only
  `GITHUB_TOKEN` and no secrets, and workflow YAML cannot generally elevate it;
- `pull_request_target` receives elevated base-repository trust and is unsafe
  when pull-request code or dependencies execute;
- each Job Summary step is limited to 1 MiB and GitHub displays at most twenty
  summaries per job;
- `@actions/core` notice, warning, and error commands produce GitHub
  annotations without creating a custom check run.

The published Rootform `0.1.0-dev.2` CLI was exercised against two synthetic
Architecture IR documents. `rootform diff before.json after.json --format
markdown --exit-code` returned documented exit `1` and complete Markdown for
added and removed entities and contexts. Action therefore needs no semantic
parser.

## Decision

- Caller owns exact checkout of current and baseline source projects. Action
  performs no Git fetch, GitHub content download, or revision selection.
- Change reporting is additive and disabled by default. `report-diff` enables
  it; `baseline-path` supplies source baseline; plan mode uses CLI plan diff;
  `fail-on-changes` controls only documented diff exit `1`.
- Existing `github-token` remains private-release read credential only. New
  `pull-request-token` performs issue-comment list, create, and update only.
- Action reads `pull_request` event metadata to identify repository, pull
  request, base SHA, head SHA, and fork status. It writes only for a
  same-repository pull request with explicit token. Fork and non-PR runs retain
  analysis, summary, annotation, and artifact but skip comments.
- No `pull_request_target` workflow is introduced.
- Action finds at most one `github-actions[bot]` comment carrying stable hidden
  marker. It updates that comment or creates one. Duplicate bot markers fail
  explicitly.
- Job Summary and comment frame exact CLI Markdown with stable identity,
  outcome, and evidence links. Outcome words derive only from documented CLI
  exits. Action never derives counts or resource meaning from JSON or Markdown.
- Internal report ceilings are 60,000 UTF-8 bytes for comment and 900 KiB for
  one summary write. Oversized CLI Markdown is replaced as a whole by explicit
  artifact-link state, never partially truncated.
- Action emits one overall notice for unchanged and one overall warning for
  changed. Policy failures retain existing Action failure behavior. Detailed
  SARIF upload stays caller-owned because it requires separate permissions and
  GitHub product configuration.
- CLI child environments remove `INPUT_GITHUB-TOKEN` and
  `INPUT_PULL-REQUEST-TOKEN`. Both values are registered with runner masking
  before network or subprocess work.

## Alternatives considered

- **Action fetches base revision.** Rejected: adds network after install,
  ambiguous revision ownership, fork credentials, and hidden Git behavior.
- **`pull_request_target` reporter.** Rejected: elevated token and secrets share
  trust boundary with potentially untrusted code or artifacts.
- **Parse diff JSON for custom cards and counts.** Rejected: duplicates CLI
  semantics and creates format coupling.
- **Require comment permission for every run.** Rejected: analysis-only callers
  need only read access, and fork runs must remain useful without secrets.
- **Reuse private-release token.** Rejected: combines unrelated read and write
  authority and would make public release usage require excessive scope.
- **Create a custom check run.** Rejected: extra `checks: write`, lifecycle, and
  annotation semantics add no evidence unavailable from native Action
  annotation, Summary, comment, and artifact.
- **Generate PDF report.** Rejected: static duplicate cannot update in place,
  hides review links, and adds rendering/runtime surface.

## Consequences

Normal snapshot callers remain unchanged. Opt-in workflows add
`pull-requests: write` and pass `${{ github.token }}` through dedicated input.
Repositories must supply exact dialects and exact base/current checkout paths.

Comments stay current instead of accumulating. Large diffs remain complete in
artifact while PR surface states why inline content is absent. Fork contributors
still receive analysis evidence but not a write credential.

Action performs one new optional post-install network operation. REST failures
are explicit because silently missing requested PR evidence would mislead
reviewers.

## Validation

Primary-source evidence:

- https://docs.github.com/en/rest/issues/comments
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
- https://github.com/actions/toolkit/tree/main/packages/core

Disposable CLI spike:

```text
rootform 0.1.0-dev.2
rootform diff before.json after.json --format markdown --output diff.md --exit-code
exit 1
```

Observed Markdown contained added and removed contexts and entities. Fixture
used synthetic VPC, subnet, and internet-gateway declarations only. No spike
artifact enters Git.

Implementation proof:

```bash
bun test src/diff.test.ts src/report.test.ts src/pull-request.test.ts
bun run verify
```

Real-run proof records pull request, run, comment, artifact, annotation, and
screenshots under SPEC-002 evidence.

## Reversal

Remove additive inputs, outputs, report modules, comment client, diff artifact
files, and report framing. Existing SPEC-001 analysis, summary, artifact,
installer, and tag behavior remains. Reconsider direct base acquisition only if
Rootform publishes a separate authenticated protocol with equivalent fork and
offline guarantees.
