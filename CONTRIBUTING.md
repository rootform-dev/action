# Contributing to the Rootform Action

This repository is pre-release and private while its foundations stabilize. The workflow is designed to remain valid when it becomes public.

## Before work starts

1. Read `AGENTS.md`, `docs/constitution.md`, and relevant accepted specs and ADRs.
2. For product behavior, obtain owner acceptance of a spec before implementation.
3. Branch from `develop` using `type/short-kebab-slug`.
4. Install exact tooling with `bun install --frozen-lockfile`, then run `bun run hooks:install`.

## Development

- Bun is the only JavaScript package manager.
- Use versions and commands defined by committed manifests and lockfiles.
- The Rootform CLI owns every architecture semantic. Never reimplement parsing, diffing, policy evaluation, or coverage here.
- Use synthetic, redacted Terraform fixtures only. Never submit real state, plans, credentials, account IDs, or customer configuration.
- `dist/` is build output. Rebuild it with its tool and never hand-edit it.
- Keep private product and AI material in paths documented by `docs/engineering/public-private-boundary.md`.
- Run focused checks while working and `bun run verify` before opening a pull request.

## Commits and pull requests

- Use Conventional Commits, for example `feat(installer): verify the published checksum`.
- Target `develop`; keep pull requests small and squash-mergeable.
- Complete the pull request template with spec, evidence, risks, and privacy review.
- Do not add automated AI attribution trailers. Human accountability remains with the contributor and reviewer.
- Do not bypass hooks or weaken gates.

## Public contribution gate

External contributions will open only after licensing, governance, and branch protection are finalized. Until then, use GitHub issues for proposals and do not assume submitted code can be accepted.
