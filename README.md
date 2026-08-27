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

Read `AGENTS.md` and `docs/constitution.md` before changing anything.

## Relationship to the product

The Rootform CLI, its semantics, and its exit codes live in
`rootform-dev/rootform`. A behavior this action cannot express is a CLI feature
request, not an action feature.
