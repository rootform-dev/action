# Rootform GitHub Action

[![Quality](https://github.com/rootform-dev/action/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/rootform-dev/action/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Analyze Terraform or OpenTofu plan and state exports, compare revisions and
check Policies in GitHub Actions. The Action installs a verified Rootform CLI;
Rootform owns interpretation, reports and exit codes. It runs no Terraform or OpenTofu,
executes no providers and makes no cloud calls.

## Quickstart

Make `plan.json` and its matching saved plan `plan.tfplan` available first:

```yaml
- uses: rootform-dev/action@v1
  id: rootform
  with:
    version: 0.1.0
    input: plan.json
    plan-file: plan.tfplan
```

The root Action infers analysis or comparison. Set `check: true` to evaluate
the project's locked Policy selections, or supply an explicit Policy selector
or Policy Pack. Nothing is selected implicitly.

Reuse `steps.rootform.outputs.form` and `steps.rootform.outputs.report` in later
steps of the same job. File outputs contain paths, never report bodies.
[Outputs and exit status](https://docs.rootform.dev/reference/outputs/)
and the [Action reference](https://docs.rootform.dev/integrations/github-actions/action/)
list the complete contract.

## Choose an entrypoint

Business actions install and prepare what they need; setup and init are optional.

| Action | Purpose |
| --- | --- |
| [Root](https://docs.rootform.dev/integrations/github-actions/action/) | Analyze or compare, optionally check and comment |
| [Setup](setup/README.md) | Install the verified CLI for later steps |
| [Init](init/README.md) | Prepare lock-selected external content |
| [Analyze](analyze/README.md) | Produce a Form and reports from one input |
| [Compare](compare/README.md) | Compare before and after evidence |
| [Check](check/README.md) | Evaluate selected Policies |

## Versions and permissions

- `version` must name an exact published CLI version. A later Action step can
  reuse the version already verified in the same job.
- Use a full commit SHA for an immutable Action reference.
- Entrypoints use Node 24 and require Actions Runner 2.327.1 or later.
- Normal use needs `contents: read`. Public installation needs no credential;
  `github-token` serves GitHub API rate limits and comments, never the CLI.

`locked: true` requires and preserves `rootform.lock`. `offline: true` uses
verified local content only. Analysis, comparison and Policy evaluation remain
network-free once selected content is available.

## Reports and pull request comments

Artifacts contain only Forms and derived reports, never raw evidence, saved
plans, credentials or the Rootform home. Summary and upload are enabled by
default. Forms and reports can
reveal topology; disable the channels that should not share it. On GitHub
Enterprise Server, set `upload-artifact: false`. Fork workflows can read eligible
[base-repository caches](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching);
set `cache: false` for private lock-selected content.

Policy outputs are published before a nonzero check fails the step. Use GitHub's
`continue-on-error` when later steps must run; the CLI verdict stays authoritative.

Only the root Action supports opt-in `comment: true`, on same-repository
`pull_request` events. Fork pull requests receive no comment; business actions
and init reject `pull_request_target`. Comments need `pull-requests: write` and
`actions: read`. All comment writers must share a job-level concurrency group
`rootform-pr-${{ github.event.pull_request.number }}` with `cancel-in-progress: false`.
See the [comment workflow](https://docs.rootform.dev/integrations/github-actions/action/).

## Contribute and license

[Contributing](CONTRIBUTING.md) covers local validation.
Source: [Apache-2.0](LICENSE). Binary release terms ship with each CLI archive.
