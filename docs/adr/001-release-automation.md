# ADR-001: Release automation for the action repository

- Status: Accepted
- Date: 2026-08-27
- Owners: @soulbah
- Related spec: repository-only foundation work

## Context

Consumers of a GitHub Action pin a Git reference. That reference is the entire
distribution channel: there is no registry, no package, and no server-side
validation between a pushed tag and a workflow that runs it. Whatever tag exists
is what strangers execute.

Two properties therefore matter more than release convenience:

- A published reference must correspond to a reviewed commit on the integration
  path, never to an ad-hoc local state.
- Version numbers must be derived from commit history rather than chosen by
  hand, because a hand-chosen number encodes intent that reviewers cannot check.

The repository already enforces Conventional Commits in `commit-msg` and in CI,
so commit history is a reliable input. At decision time the repository
published no `src/`, `dist/`, or `action.yml`. Release automation therefore
needed an explicit `0.x` baseline so its first computed version could not
default to an accidental `1.0.0` compatibility promise before the surface
existed.

## Decision

Releases are produced by semantic-release 25.0.9, running from
`.github/workflows/release.yml` on pushes to `main` only.

- Plugins: `commit-analyzer`, `release-notes-generator` (both on the
  `conventionalcommits` preset), and `github`. The tag and the GitHub Release
  are created in one step from the same commit.
- `tagFormat` is `v${version}`.
- A breaking change maps to a **minor** bump, not a major one, so automation
  cannot publish `v1.0.0`. Promoting the action to `1.0.0` is a deliberate owner
  action and requires this ADR to be superseded.
- `@semantic-release/npm`, `@semantic-release/git`, and `@semantic-release/exec`
  are excluded. Nothing is published to a registry, no version field is
  rewritten, no commit is pushed back to a protected branch, and no arbitrary
  shell command runs with a release token.
- The workflow requests `contents: read` at file level and grants
  `contents: write` only to the release job. Issue and pull-request commenting
  is disabled in the `github` plugin, so no wider scope is needed.
- The release job runs `node ./node_modules/semantic-release/bin/semantic-release.js`
  from the committed lockfile. semantic-release 25 requires Node
  `^22.14.0 || >= 24.10.0`, which Bun does not satisfy, so the job installs Node
  24.20.0 alongside the pinned Bun used for dependency installation.
- No floating major tag (`v1`, `v0`) is maintained. Moving a published tag is
  already blocked by the agent policy, and a floating tag would silently change
  what a pinned consumer executes.

Workflow static analysis is added to the same gate: actionlint 1.7.12, installed
from a checksum-verified release archive in CI and required by `bun run verify`.

## Alternatives considered

- **Manual `gh release create`.** Rejected: the version number becomes a human
  choice, release notes drift from history, and the agent policy already blocks
  release mutation from automation for good reason.
- **`release-please`.** Rejected: it maintains a release pull request and
  version files in the repository even though Action distribution needs only
  immutable Git references, so a bot editing version fields adds state without
  value.
- **Default major bump on breaking changes.** Rejected: it would publish
  `v1.0.0` from the first `feat!` commit, before any entrypoint exists.
- **`@semantic-release/git` to commit version bumps.** Rejected: it requires a
  bot push into `main`, which conflicts with branch protection and with the rule
  that automation does not write to protected branches.
- **CodeQL, Scorecard, dependency-review, and zizmor.** Deferred, not rejected.
  The repository contains no application source, so CodeQL has nothing to
  analyze; dependency-review needs a dependency graph the private repository
  does not expose; Scorecard is meaningful once the repository is public.
  actionlint covers the only executable surface that exists today. These are
  reconsidered when `src/` lands and when the repository becomes public.

## Consequences

- A merge into `main` with a `feat` or `fix` commit publishes a tag and a
  release without further action. A merge containing only `chore`, `ci`, or
  `docs` commits publishes nothing, which is the intended behavior.
- Release notes quality is now a property of commit subjects. A vague subject
  produces a vague release note; the commit gate is the control.
- The first release will be `0.1.1` or `0.2.0` relative to the seeded `v0.1.0`
  tag, never `1.0.0`.
- Two runtimes exist in the release job (Bun for dependencies, Node for
  semantic-release). This is a documented cost of semantic-release's engine
  requirement, not an architectural preference.
- 290 additional development dependencies enter `bun.lock`. None of them ship to
  action consumers: they are development-only and the published surface is the
  committed bundle.

## Validation

```bash
actionlint -no-color -oneline
bun run verify
```

- `bun scripts/validate-foundation.ts` fails when `.releaserc.json` targets a
  branch other than `main`, changes `tagFormat`, adds a publishing or
  repository-writing plugin, or maps a breaking change to a major bump.
- Registry-verified pins on 2026-08-27: semantic-release 25.0.9,
  `@semantic-release/commit-analyzer` 13.0.1,
  `@semantic-release/release-notes-generator` 14.1.1,
  `@semantic-release/github` 12.0.9,
  `conventional-changelog-conventionalcommits` 10.4.0, Node 24.20.0 LTS,
  actionlint 1.7.12 (`sha256:8aca8db9…a3d8` for `linux_amd64`).

## Reversal

Delete `.github/workflows/release.yml` and `.releaserc.json`, drop the release
dependencies, and remove the release entries from the foundation validator.
Already-published tags and releases are unaffected because nothing rewrites
them. Reconsider when the action publishes a stable surface and needs a `1.0.0`
promotion, or if release notes stop reflecting what changed.
