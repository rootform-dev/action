# Contributing to the Rootform Action

## Before work starts

1. Read `AGENTS.md`, `docs/constitution.md`, and relevant accepted specs and ADRs.
2. For product behavior, obtain owner acceptance of a spec before implementation.
3. Branch from `dev` using `type/short-kebab-slug`.
4. Install exact tooling with `bun install --frozen-lockfile`, then run `bun run hooks:install`.
5. Install the external gate tools the full check needs: Gitleaks 8.30.1 and actionlint 1.7.12.

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
- Target `dev`; keep pull requests small and squash-mergeable.
- Complete the pull request template with spec, evidence, risks, and privacy review.
- Do not add automated AI attribution trailers. Human accountability remains with the contributor and reviewer.
- Do not bypass hooks or weaken gates.
- Contributions are accepted under the [Apache License 2.0](LICENSE). Submitting a
  pull request means you have the right to license your contribution under it.

Commit subjects are the release notes. `fix:` and `feat:` reach the published
changelog verbatim, so write the subject for a reader who does not know the
change.

## How a release happens

Merging into `dev` publishes nothing, and neither does promotion. A promotion
is a pull request from `dev` into `main`; once `quality` passes on its exact
head, a maintainer runs `gh workflow run promote.yml --ref dev -f pull_request=<number>`,
which fast-forwards `main` to that commit.

A release is a separate maintainer dispatch on `main`:

1. `gh workflow run published-release-integration.yml --ref main -f version=<stable Rootform version>`
   proves the promoted commit installs a published Rootform release anonymously.
2. `gh workflow run release.yml --ref main` checks that proof and `quality` on
   the same commit, then semantic-release computes the version from the
   Conventional Commit history and creates the tag and the GitHub Release
   together. `fix` is a patch, `feat` a minor and a breaking change a new
   major version. A promotion carrying only `chore`, `ci`, `docs`, `style`,
   `test`, or `refactor` commits releases nothing.
3. The same run points the major tag (`v1` for `v1.x.y`) at the new release.
   It only moves forward, and only once GitHub reports the release immutable
   (the repository enforces immutable releases). Rerunning resumes an
   interrupted release. See `docs/adr/007-promoted-releases-and-major-tags.md`.

Never create, move, or delete a tag or release by hand. Published references are
what other people's workflows execute; correct a mistake with a new release.

`CODE_OF_CONDUCT.md` applies to every interaction in this repository.
