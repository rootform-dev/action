# Rootform Action

[![Quality](https://github.com/rootform-dev/action/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/rootform-dev/action/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

GitHub Actions integration for [Rootform](https://github.com/rootform-dev/rootform),
the deterministic Terraform architecture compiler.

## Release status

Source is available for review before the first consumer Action release. No
supported consumer tag exists yet. The examples below document the accepted
surface and become runnable when the owner publishes `v1`.

## Published usage contract

Two entrypoints share one installer:

```yaml
# Integrated experience: install Rootform, analyze source, publish results
- uses: rootform-dev/action@v1
  with:
    version: 0.1.1
    path: .

# Installation only, for advanced usage
- uses: rootform-dev/action/setup@v1
  with:
    version: 0.1.1
```

Main entrypoint accepts `source` or `plan` mode. By default it writes
Architecture IR, self-contained HTML, policy JSON, SARIF, and CLI Markdown;
uploads only four named machine/render files; and appends exact CLI policy
Markdown to Job Summary. It never parses artifacts to invent semantic or
policy conclusions.

## Dialect preparation

Before analyzing anything, the main entrypoint prepares the project once by
running the Rootform CLI initialization command. That single command resolves
providers, selects dialects, acquires what is missing, and writes
`rootform.lock`. The Action reports what the CLI said; it never resolves,
downloads, or locks anything itself.

```yaml
- uses: rootform-dev/action@v1
  with:
    path: infra
    locked: true      # require and preserve the existing rootform.lock
    offline: true     # use only vendored, installed, and cached dialect data
```

`locked` and `offline` are independent, and they map to the CLI's own flags:

| `locked` | `offline` | Behavior |
| --- | --- | --- |
| `false` | `false` | Resolve normally and write `rootform.lock` when needed |
| `true` | `false` | Require an existing lock; still fetch exactly what it pins |
| `false` | `true` | Resolve without any network access |
| `true` | `true` | Fully frozen: existing lock, no network |

Preparation is always non-interactive, so a job can never wait for a prompt.

A run in a repository without a lock completes and reports the generated file
through `lock-created` and `lock-path`, includes it in the uploaded artifact,
and states in the Job Summary that it should be committed. The Action never
stages, commits, or pushes it.

The Rootform home is created per job under the runner temporary directory and
exported as `ROOTFORM_HOME` so later steps in the same job reuse it. Its
absolute path is never published as an output, in the Job Summary, or in an
artifact.

`cache` defaults to `true` and reuses verified immutable dialect payload
between runs: installed dialects and content-addressed blobs only. The official
index is never cached, because it is mutable selection state and sharing it
between two revisions of a pull request would let one revision decide what the
other resolves. A restored entry is never authoritative — preparation still runs
and the CLI re-verifies every dialect by digest, so a cache miss, a cache error,
and a poisoned entry are all equivalent to a slower run.

A failed preparation stops the job with the CLI diagnostic, runs no analysis
command, and leaves the project lock untouched.

The `setup` entrypoint installs and verifies a CLI. It never prepares dialects.

## Pull request architecture review

Opt-in reporting compares caller-owned exact checkouts, publishes Rootform CLI
diff and policy Markdown in Job Summary, updates one pull-request comment, and
uploads complete machine evidence:

```yaml
name: Rootform architecture

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - name: Check out head
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          path: rootform-head
          ref: ${{ github.event.pull_request.head.sha }}

      - name: Check out base
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          path: rootform-base
          ref: ${{ github.event.pull_request.base.sha }}

      - name: Review architecture
        uses: rootform-dev/action@v1
        with:
          path: rootform-head
          baseline-path: rootform-base
          report-diff: true
          pull-request-token: ${{ github.token }}
```

Action runs each source project from its own root and does not fetch Git
revisions. Fork pull requests still receive Summary and artifact evidence, but
Action never uses a write token on them. Workflows must use `pull_request`, not
`pull_request_target`.

`report-diff` defaults to `false`. `fail-on-changes` gates documented diff exit
`1` independently from `fail-on-violations`. Plan mode needs no
`baseline-path`: Rootform derives before and planned architectures from the
named plan JSON.

The artifact inventory stays fixed. Existing analysis uploads current
Architecture IR and HTML plus policy JSON and SARIF. Source diff reporting adds
baseline Architecture IR and HTML plus exact diff JSON and Markdown. Plan diff
reporting adds exact diff JSON and Markdown.

Release archive and `SHA256SUMS` must both match GitHub asset metadata. Binary
enters tool cache and `PATH` only after archive checksum and reported version
match requested release.

## Working in this repository

```bash
bun install --frozen-lockfile
bun run hooks:install
bun run verify
```

`bun run check` is the fast gate used while iterating. `bun run verify` is the
complete gate and the only basis for a completion claim.

The full gate needs two external tools on `PATH`: Gitleaks 8.30.1 and actionlint
1.7.12. CI installs both from checksum-verified release archives; locally,
install them with your own package manager.

Read `AGENTS.md` and `docs/constitution.md` before changing anything.

## Releases

Releases are automated. Merging into `dev` publishes nothing; merging `dev` into
`main` runs `.github/workflows/release.yml`, which derives the next version from
the Conventional Commit history and creates both the Git tag and the GitHub
Release in one step.

| Merged commits | Result |
| --- | --- |
| `fix:` or `perf:` | patch release |
| `feat:` | minor release |
| `feat!:` or `BREAKING CHANGE:` | minor release while the action is `0.x` |
| only `chore:`, `ci:`, `docs:`, `style:`, `test:`, `refactor:` | no release |

Nothing is published to a package registry, no version field is rewritten, and
no commit is pushed back into a protected branch. Tags are immutable: a mistake
is corrected by a new release, never by moving a published tag. `1.0.0` is a
deliberate owner decision and requires superseding `docs/adr/001-release-automation.md`.

## Relationship to the product

`rootform-dev/rootform` owns release assets and contracts. Action consumes the
documented CLI surface only; it does not duplicate Rootform semantics.

## License

Rootform Action source is licensed under [Apache License 2.0](LICENSE). Rootform
binary release terms are separate and ship with each distribution archive.
