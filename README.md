# Rootform Action

[![Quality](https://github.com/rootform-dev/action/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/rootform-dev/action/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

GitHub Actions integration for [Rootform](https://github.com/rootform-dev/rootform),
the deterministic Terraform architecture compiler.

## Usage

Two entrypoints share one installer:

```yaml
# Integrated experience: install Rootform, analyze source, publish results
- uses: rootform-dev/action@v1
  with:
    version: 0.1.0
    path: .

# Installation only, for advanced usage
- uses: rootform-dev/action/setup@v1
  with:
    version: 0.1.0
```

Main entrypoint accepts `source` or `plan` mode. It writes Architecture IR,
self-contained HTML, policy JSON, SARIF, and CLI Markdown; uploads only four
named machine/render files; and appends only CLI Markdown to Job Summary. It
never parses artifacts to invent semantic or policy conclusions.

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
