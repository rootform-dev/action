# Rootform GitHub Action

[![Quality](https://github.com/rootform-dev/action/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/rootform-dev/action/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Rootform Action passes Terraform plan or state exports, or saved Rootform Forms,
to the published Rootform CLI. Rootform owns input validation, architecture
semantics, Policy evaluation and exit codes. The Action installs and verifies
the CLI, forwards its reports, and never executes Terraform or OpenTofu.

## The v1 surface

The six v1 refs
<code>rootform-dev/action@v1</code>,
<code>rootform-dev/action/setup@v1</code>,
<code>rootform-dev/action/init@v1</code>,
<code>rootform-dev/action/analyze@v1</code>,
<code>rootform-dev/action/compare@v1</code> and
<code>rootform-dev/action/check@v1</code> share one reviewed source commit.
Use a full commit SHA when an immutable Action pin is required. Public
qualification is recorded in
[SPEC-006 evidence](specs/006-github-native-actions/evidence/qualification.md).

Examples use the exact Rootform CLI release selected for qualification: the
published prerelease
[0.1.0-pr.117.1](https://github.com/rootform-dev/rootform/releases/tag/v0.1.0-pr.117.1).
This is a prerelease; the example does not imply that stable CLI 0.1.0 has been
published.

## Golden path

Make a plan or state JSON file available in the workspace, then call the root
Action. The input can also be a saved Form.

```yaml
name: Rootform
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      # Generate or download plan.json before this step when it is not committed.
      - uses: rootform-dev/action@v1
        id: rootform
        with:
          version: 0.1.0-pr.117.1
          input: plan.json
```

The input accepts a plan export, a state export or a saved Form. Use the
optional <code>plan-file</code> input only with its matching plan export; a
supplied plan pairing must verify. For plan/state input, one multi-output
invocation produces the Form and reports. A saved Form keeps its original path
and bytes; Rootform only renders its reports. JavaScript does not interpret
architecture or Policy result JSON to decide what the input means or whether
it passes.

Comparison is optional. Supply both operands to the root Action or use the
dedicated compare entrypoint:

```yaml
- uses: rootform-dev/action@v1
  id: comparison
  with:
    version: 0.1.0-pr.117.1
    before: before/plan.json
    after: after/plan.json
```

Each operand may be a plan export, state export or single-input Form. Pair
<code>before-plan-file</code> or <code>after-plan-file</code> with the
corresponding plan export when you have saved binary plan evidence. A
comparison produces one Comparison Form; the before and after operands are not
separate Action outputs.

Analysis alone makes no Policy claim. On the root Action, supplying a
<code>policy</code> selector or <code>policy-pack</code> overlay also requests a
check. Set <code>check: true</code> to evaluate every Policy selected by the
project's <code>rootform.lock</code>. Selectors can narrow the selected
Policies. No Policy Pack is selected implicitly.

## Results and reuse

Business entrypoints append CLI Markdown to the GitHub Job Summary by default
and upload derived evidence by default. The Summary forwards CLI reports and
run/version/evidence links; it does not calculate semantic counts. Set
<code>summary: false</code> to disable only the Summary, or
<code>upload-artifact: false</code> to disable
artifact upload. For private or sensitive repositories, disable both unless
sharing derived evidence through these channels is intended; PR comments remain
opt-in.

Action outputs such as <code>form</code>, <code>report</code>, <code>html</code>,
<code>result</code> and <code>sarif</code> are file paths for reuse by later
steps in the same job. They may be absolute runner temporary paths; they
contain no file bodies. For a comparison, <code>form</code> is the single
Comparison Form path. The Action does not expose separate operand Form paths.

| Entrypoint | File outputs |
| --- | --- |
| analyze | form, report, html |
| compare | form (Comparison Form), report, html |
| check | form, result, report, sarif; exact exit-code |
| root | The outputs produced by its analyze/compare and optional check flows |

All entrypoints expose the verified CLI version. Setup also exposes its
executable sha256; business actions expose artifact-id/url when upload succeeds.

Artifacts serve cross-job transfer. The <code>artifact-id</code> and
<code>artifact-url</code> outputs identify the uploaded artifact; a same-job
file path cannot be reused by another runner. Artifacts contain only a valid
Form and derived reports that Rootform produced or reopened, with fixed
basenames when present: <code>form.json</code>, <code>report.md</code>,
<code>explorer.html</code>, <code>result.json</code> and
<code>results.sarif</code>. Raw plan/state exports, saved binary plans,
arbitrary project files, credentials and the Rootform home are never uploaded.

The default artifact name is unique per Action invocation, including matrix
and monorepo jobs. If you set <code>artifact-name</code>, make it unique for
every invocation that uploads within the workflow. Retention defaults to
seven days; <code>retention-days</code> accepts 1–90 days and remains subject
to the repository's retention limit.

The <code>exit-code</code> output preserves Rootform's exact check exit code.
Rootform reports and enabled publication channels are attempted before a
non-zero check exit fails the step. Use GitHub's step-level
<code>continue-on-error</code> when later steps must run; no Action input
reinterprets a Rootform verdict.

## Installation and project preparation

Every entrypoint requires an exact published Rootform version unless an
earlier Rootform Action step in the same job installed and verified the
version. There is no latest or version-range resolution. Public release access
does not require a credential; the optional <code>github-token</code> defaults
to <code>github.token</code> to help with GitHub API rate limits and is also
used by the root Action when PR commenting is enabled. Normal workflows need
only <code>contents: read</code>.

Before execution, the installer checks the published release asset API digests,
the archive checksum in SHA256SUMS, and the release manifest's raw executable
hash. Cached and PATH executables receive the same hash and exact-version
checks before use. These checks verify release bytes; they do not attest build
provenance.

All six entrypoints run on Node 24 and require Actions Runner 2.327.1 or newer
([Node 24 runner requirement](https://github.com/actions/setup-node#breaking-changes-in-v5)).
This requirement applies to self-hosted runners as well.

Raw input analysis and Policy checks prepare the project's selected external
content through Rootform. The project defaults to the workspace.
<code>locked: true</code> requires and preserves its existing
<code>rootform.lock</code>; the Action never creates or edits the lock.
<code>offline: true</code> asks the CLI to use verified local content only.
Saved Forms reopened for analysis need no project preparation.

Business entrypoints create one job-local <code>ROOTFORM_HOME</code> and export
it for later steps, or reuse a caller-supplied home. The init entrypoint
prepares content in that shared home. Setup only installs and verifies the
CLI; it does not prepare content or create the Rootform home.

<code>cache</code> defaults to enabled, but caching is used only when the
project has a lock. Its key uses the exact CLI version, runner platform and
lock-file bytes; it excludes the locked and offline modes and never falls back
to a cache for another lock. An online run can therefore warm a cache for a
later offline run with the same version, platform and lock. The cache stores
only external Dialect and Policy Pack source payloads selected by that lock.
It never stores credentials, Forms, reports, linked artifacts, temporary
files or discovery state. GitHub allows eligible
fork pull-request runs to restore base-repository caches
([cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)),
so treat cache contents as readable by pull-request authors. Set
<code>cache: false</code> if
selected source payloads are not appropriate for that visibility. Restored
payloads are untrusted until Rootform verifies the selected package digests
again.

## Pull-request comments

Only the root Action supports opt-in comments, through
<code>comment: true</code>. The comment is written only for a same-repository
<code>pull_request</code>; fork pull requests skip the comment. Business
entrypoints and init reject <code>pull_request_target</code>
before CLI installation. Commenting is supported on GitHub.com only.

Commenting needs <code>pull-requests: write</code> to create or update the
comment and <code>actions: read</code> to check the current workflow run. Keep
the other permission at <code>contents: read</code>. The default
<code>github.token</code> is used unless you supply a different
<code>github-token</code>.

Every workflow that may report on a PR must use the same job-level concurrency
group, based only on the PR number, and set
<code>cancel-in-progress: false</code>. Do not include the workflow name in the
group; sharing the exact group serializes
reporter jobs across workflows for that PR.

```yaml
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  actions: read

jobs:
  report:
    runs-on: ubuntu-latest
    concurrency:
      group: rootform-pr-${{ github.event.pull_request.number }}
      cancel-in-progress: false
    steps:
      - uses: rootform-dev/action@v1
        with:
          version: 0.1.0-pr.117.1
          input: plan.json
          comment: true
```

Make plan.json available before the shown step. The Action rechecks the pull
request HEAD and current workflow run attempt before it writes. GitHub's
comment API has no compare-and-swap operation, so those checks alone cannot
make an update atomic. The shared concurrency group is part of the reporting
contract.

## Advanced entrypoints

The root Action is the usual starting point. Each primitive can also run on its
own; setup and init are optional:

| Ref | Purpose |
| --- | --- |
| <code>rootform-dev/action/setup@v1</code> | Install and verify the exact CLI; prepare no project content. |
| <code>rootform-dev/action/init@v1</code> | Prepare external content selected by the project lock. |
| <code>rootform-dev/action/analyze@v1</code> | Analyze one plan, state export or Form. |
| <code>rootform-dev/action/compare@v1</code> | Compare before and after plan, state or Form operands. |
| <code>rootform-dev/action/check@v1</code> | Check a plan, state or Form against selected Policies. |

Business entrypoints install the CLI and prepare content when their inputs need
it. A separate setup or init step is not required. When setup is used, later
steps can inherit its verified exact CLI version; all business steps in a job
reuse the same <code>ROOTFORM_HOME</code>.

Check a plan directly; no preceding analyze step is required:

```yaml
- uses: rootform-dev/action/check@v1
  id: policies
  with:
    version: 0.1.0-pr.117.1
    input: plan.json
    policy-pack: policy-packs/team
```

Reuse a Form from an earlier action through
`input: ${{ steps.rootform.outputs.form }}`. A downloaded Form works the same
way. Analyze and check can reopen a Comparison Form; compare accepts only
single-input Forms as operands. For check, `side` selects `before`, `after`, or
`both` (CLI default). Policy selectors and pack paths accept one value per line.

## Support and scope

The Action consumes plan/state exports and saved Forms. It does not accept
Terraform configuration source, run Terraform or OpenTofu, plan or apply
infrastructure, or request cloud, provider or backend credentials.

Current GitHub artifact transport is not supported on GitHub Enterprise Server
(GHES) ([artifact support](https://github.com/actions/upload-artifact#ghes-support)).
Set <code>upload-artifact: false</code> there; this leaves same-job path
outputs and Summary behavior available. Pull-request comments require
GitHub.com.

## License

Rootform Action source is licensed under [Apache License 2.0](LICENSE).
Rootform binary release terms are separate and ship with each distribution
archive.
