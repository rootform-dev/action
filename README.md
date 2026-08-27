# Rootform Action

GitHub Actions integration for [Rootform](https://github.com/rootform-dev/rootform),
the deterministic Terraform architecture compiler.

This repository is pre-release and holds no published action yet. What exists
today is the engineering foundation: governance, quality gates, and the agent
guardrails the implementation will be built under.

## Intended surface

Two entrypoints share one installer:

```yaml
# Integrated experience: install Rootform, then analyze
- uses: rootform-dev/action@v1

# Installation only, for advanced usage
- uses: rootform-dev/action/setup@v1
```

The action installs a pinned Rootform CLI, runs it, and reports what it said.
It never reimplements parsing, diffing, policy evaluation, or coverage.

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

Manual steps that remain with the owner: making the repository public, enabling
branch protection on `dev` and `main`, and promoting the action to `1.0.0`.

## Relationship to the product

The Rootform CLI, its semantics, and its exit codes live in
`rootform-dev/rootform`. A behavior this action cannot express is a CLI feature
request, not an action feature.
