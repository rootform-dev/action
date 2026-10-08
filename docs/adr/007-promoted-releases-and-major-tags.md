# ADR-007: Promoted releases and major tags

- Status: Accepted
- Date: 2026-10-07
- Owners: @soulbah
- Owner approval: @soulbah — 2026-10-07 (delivery architecture direction: `main` moves only by promotion of validated `dev`, a breaking change is a new major version, and the major tag names a qualified compatible release)
- Related spec: repository-only release automation
- Supersedes: ADR-001 for the release trigger, the breaking-change rule and floating major tags; the `publish-v1.yml` bootstrap described in ADR-006

## Context

ADR-001 published a release on every push to `main` and mapped a breaking
change to a minor bump so that automation could never reach `1.0.0`. ADR-006
then created the `v1` ref once, through a dedicated bootstrap dispatch on a
`dev` commit, and forbade moving it.

Three facts make that model wrong for a public Action:

- README and migration guide tell consumers to use `rootform-dev/action@v1`.
  `v1` names commit `17cf0cbe` on `dev`, which no release describes, and it
  can never advance to a fix.
- GitHub's guidance for Actions is semantic version release tags, a major tag
  moved to the newest compatible release, and a new major version for breaking
  changes. Immutable releases protect each `vX.Y.Z` tag once published.
- Promoting `dev` into `main` must not publish anything by itself. A release
  started by the same push that moved `main` runs after the fact and cannot
  act as a gate.

Since the seeded `v0.1.0` tag, `main`-bound history contains breaking commits
(the GitHub-native redesign and its predecessor), so the first computed release
under default rules is `v1.0.0`, which matches the public `@v1` contract.

## Decision

- `main` changes only through a pull request from `dev`. `quality` runs on
  that exact head; `promote.yml`, dispatched from `dev` with the pull request
  number, fast-forwards `main` to that commit and nothing else. No workflow
  runs on push. `main` stays an ancestor of `dev`, so no back-merge exists; a
  hotfix is a pull request into `dev` followed by a promotion.
- `release.yml` runs only on `workflow_dispatch` from `main`. Before
  semantic-release runs, it requires that `main` still equals the dispatched
  commit, that `quality` passed on it, and that `published-release-integration`
  succeeded on it against a stable published Rootform release (its run name
  records the version).
- semantic-release keeps the `conventionalcommits` defaults: `fix` is a
  patch, `feat` a minor, a breaking change a major version. A promotion with
  only `chore`, `ci`, `docs`, `refactor`, `style` or `test` commits
  releases nothing.
- After publishing `vX.Y.Z` with X of 1 or more, the same run points the `vX`
  tag at that commit. The tag only moves forward: the new commit must descend
  from the commit `vX` names today, otherwise the run fails. A new major
  creates its own tag; `v0` is never maintained. Version tags never move.
- A rerun resumes: if semantic-release pushed a tag without its release, the
  run publishes the release for that tag, then moves the major tag.
- The repository enforces immutable releases, so a published `vX.Y.Z` tag
  and its release can no longer change. The run moves the major tag only
  after GitHub reports the new release immutable.
- `publish-v1.yml` is removed. The existing `v1` advances to `v1.0.0` through
  the first release run.
- Running `release.yml` remains an owner decision.

## Alternatives considered

- **Keep the push-triggered release.** Rejected: a promotion would publish
  immediately, and the only proof would come from CI after publication.
- **Keep breaking changes as minor bumps.** Rejected: consumers of `@v1` would
  receive breaking changes under the same major tag.
- **A separate workflow to move the major tag.** Rejected: the release is
  qualified before it exists, so a second dispatch adds a manual step without
  adding evidence. The release run carries both steps and resumes either.
- **release-please.** Rejected for the reasons in ADR-001: the Action
  distributes Git refs and needs no version file.

## Consequences

- A promotion publishes nothing. A release is one owner dispatch after the
  published release integration of the promoted commit.
- The first release is `v1.0.0`; `v1` then names a published, qualified
  release and follows each compatible release.
- The Action cannot release before Rootform publishes a stable version, which
  matches its contract of consuming only published Rootform releases.
- The release job needs `actions: read` and `checks: read` in addition to
  `contents: write`.

## Validation

```bash
bun scripts/validate-foundation.ts
bun test scripts/validate-foundation.test.ts scripts/verify.test.ts
actionlint -no-color -oneline
```

The foundation validator fails when a release rule ships a breaking change as
anything but a major version, or when `release.yml` runs on any event other
than `workflow_dispatch`.

## Reversal

Restore a push trigger and custom release rules, and delete the major tag step.
Published releases and tags stay valid because nothing rewrites them.

## Sources

- https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions
- https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases
- https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases
- https://semantic-release.gitbook.io/semantic-release/support/faq
