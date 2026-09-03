# Going public

This repository is built for public review. Everything automatable is enforced
by `bun run verify` and CI; repository settings and checks requiring human
judgment remain explicit here.

For a first visibility change, do the steps in order. Repeat history and public
surface review before every release.

## 1. Confirm history is publishable

```bash
bun run verify
```

The full gate scans the working set and the entire Git history for secrets, and
refuses absolute personal paths and private material in tracked files. Then read
the repository metadata a scan cannot see: repository description, topics,
release notes, issue titles, and the author names and email addresses in
`git log`. Deleting a tracked secret does not remove it from history; a leak
found after publication must be rotated, not deleted.

## 2. Review the public surface

- `README.md` describes what exists, not what is planned.
- `SECURITY.md` points at private advisory reporting.
- `CODE_OF_CONDUCT.md` and the issue templates name this repository.
- `LICENSE` is the verbatim Apache License 2.0, matching the CLI it orchestrates.
- No committed behavior depends on an ignored private file.

## 3. Make the repository public

Settings → General → Danger Zone → Change visibility. Branch protection and
GitHub's free security features stay unavailable on a private repository, so
this step unblocks the rest.

## 4. Protect `main` and `dev`

`main` is what consumer tags come from; `dev` is what merges into it. Both need
a ruleset that requires:

- a pull request;
- the `quality` status check to pass;
- branches to be up to date before merging;
- linear history, with squash merge as the only merge method;
- no force push and no deletion.

Require an independent approval when a reviewer other than the pull-request
author is available; do not create a permanent single-maintainer deadlock.

Do not add an exemption for automation. The release workflow creates tags and
releases; it never pushes a commit into a protected branch, so it needs no
bypass. Verify with:

```bash
gh api repos/rootform-dev/action/rulesets
```

## 5. Enable the free security features

Settings → Code security: secret scanning, push protection, and Dependabot
alerts and security updates. Push protection is the layer that stops a secret
before it reaches history, which the local hooks cannot guarantee.

## 6. Reconsider the deferred scanners

`docs/adr/001-release-automation.md` deferred CodeQL, Scorecard,
dependency-review, and zizmor because no application source existed at decision
time. Once source and public dependency data exist, enable CodeQL for supported
languages. Add other scanners separately only when their distinct signal earns
their runtime and maintenance cost.

## What stays automated

Releases. Merging `dev` into `main` derives the version from commit history and
publishes the tag and the GitHub Release together. Never create, move, or delete
a tag by hand: a published reference is what other people's workflows execute.
