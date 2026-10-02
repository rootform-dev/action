# Rootform GitHub Action

[![Quality](https://github.com/rootform-dev/action/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/rootform-dev/action/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Review Terraform or OpenTofu plan and state exports, or reuse a saved Rootform
Form, in GitHub Actions. Rootform interprets the evidence and owns comparison,
Policy results, and exit codes. The Action installs the published CLI and
reports its results. It never runs Terraform or OpenTofu, executes providers,
or contacts a cloud account.

## Quickstart

After a trusted workflow step has made `plan.json` and its matching saved plan
`plan.tfplan` available in the workspace, add this step:

```yaml
- uses: rootform-dev/action@v1
  id: rootform
  with:
    version: 0.1.0
    input: plan.json
    plan-file: plan.tfplan
```

The root Action infers analysis or comparison from the inputs. To check
Policies, set `check: true` for the project's locked selections, or supply a
Policy selector or Policy Pack. Nothing is selected implicitly. Use the
`form`, `report`, or other output paths in later steps of the same job.

## Guides and full reference

The root Action is the normal starting point. Reach for a standalone primitive
when you want an explicit install, preparation, analysis, comparison, or check
step. Setup and init are optional because business actions install and prepare
what they need.

| Action | Use | Guide |
| --- | --- | --- |
| Root | Analyze or compare, optionally check and comment | [Quickstart](#quickstart) |
| Setup | Install the verified CLI for later steps | [Setup](setup/README.md) |
| Init | Prepare lock-selected external content | [Init](init/README.md) |
| Analyze | Produce a Form and reports from one input | [Analyze](analyze/README.md) |
| Compare | Compare before and after evidence | [Compare](compare/README.md) |
| Check | Evaluate selected Policies directly | [Check](check/README.md) |

Canonical Rootform user documentation contains the complete input/output
contract:

- [GitHub Actions overview](https://docs.rootform.dev/integrations/github-actions/)
- [Root Action reference](https://docs.rootform.dev/integrations/github-actions/action/)
- [Setup reference](https://docs.rootform.dev/integrations/github-actions/setup/)
- [Init reference](https://docs.rootform.dev/integrations/github-actions/init/)
- [Analyze reference](https://docs.rootform.dev/integrations/github-actions/analyze/)
- [Compare reference](https://docs.rootform.dev/integrations/github-actions/compare/)
- [Check reference](https://docs.rootform.dev/integrations/github-actions/check/)

## Version, permissions, and data

Give `version` an exact published Rootform CLI version. There is no `latest`
or version-range lookup. A later Rootform Action step in the same job may reuse
the exact version installed and verified by an earlier step. Public release
installation needs no credential; `github-token` defaults to `github.token`
for GitHub API rate limits and root Action comments, and is never passed to the
CLI. The installer verifies release digests, the archive checksum, and the
executable hash before use. Use a full commit SHA when you need an immutable
Action ref. All entrypoints use Node 24 and require Actions Runner 2.327.1 or
newer. Normal use needs only `contents: read`.

Once selected content is available, Rootform analysis, comparison, and Policy
evaluation are network-free. When raw evidence or Policy selection needs
project content, the Action asks Rootform to prepare the exact external content
selected by the project's `rootform.lock`.
`locked: true` requires and preserves that existing lock; the Action never
creates or edits it. `offline: true` requests local verified content only.

File outputs are reusable paths, never Form or report bodies. The analyze
and compare actions return `form`, `report`, and `html` paths. Check returns
`form`, `result`, `report`, `sarif`, and the exact `exit-code`; compare exposes
one Comparison Form, not separate before/after Form paths. A path works only
within its job. Use an artifact ID or URL to transfer evidence between jobs.

Summary and artifact upload are enabled by default for business actions.
Artifacts contain only valid Forms and derived reports, never raw plan/state
exports, saved binary plans, arbitrary project files, credentials, or the
Rootform home. Derived Forms and reports can disclose infrastructure topology;
disable Summary or upload when that audience should not see them. Artifact
retention defaults to seven days and accepts 1–90 days, subject to the
repository limit. Default names are unique per invocation, including matrix
jobs. If setting `artifact-name`, make it unique for every upload. GitHub
Enterprise Server does not support this artifact transport; set
`upload-artifact: false` there.

Eligible fork pull request workflows can read caches from the base repository.
Set `cache: false` if lock-selected Dialect or Policy Pack sources should not
be readable by pull request authors. See GitHub's
[cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

Rootform's exact check exit code remains authoritative. Available outputs,
Summary, artifacts, and an eligible comment are published before a nonzero
check fails the step. Use GitHub's step-level `continue-on-error` if later
steps must run; no Action input changes the verdict.

## Pull request comments

Only the root Action supports opt-in comments. Comments are limited to
same-repository `pull_request` events; fork pull requests receive no comment.
Business entrypoints and init reject `pull_request_target` before installing
the CLI. Commenting requires `pull-requests: write` and `actions: read`, in
addition to `contents: read`, and is supported on GitHub.com.

Every workflow that may report on a pull request must share the same job-level
concurrency group, based only on the PR number, with cancellation disabled.
This prevents concurrent comment writers across workflows. Make the matching
`plan.json` and `plan.tfplan` available before the shown Action step:

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
          version: 0.1.0
          input: plan.json
          plan-file: plan.tfplan
          comment: true
```

The Action checks the current pull request HEAD, workflow run, and attempt
before writing. GitHub's comment API has no atomic conditional update, so shared
concurrency is part of the comment contract. Comments and enabled evidence
channels may expose topology; choose their audience accordingly.

## License

Rootform Action source is licensed under [Apache License 2.0](LICENSE).
Rootform binary release terms are separate and ship with each distribution
archive.
