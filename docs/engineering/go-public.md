# Going public

This repository is built to be published. Everything automatable is already
enforced by `bun run verify` and CI; what remains are the settings only a
repository owner can change, plus the checks that need human judgment.

Do the steps in order. Steps 1 to 3 happen before the repository becomes
visible, because their failure modes are irreversible once history is public.

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

## 2. Choose and add a license

No `LICENSE` file exists yet, and the agent policy blocks automation from
writing one. Until a license is committed, published code carries no usage
rights. Add the license the owner intends, and state it in `README.md`.

## 3. Review the public surface

- `README.md` describes what exists, not what is planned.
- `SECURITY.md` points at private advisory reporting.
- `CODE_OF_CONDUCT.md` and the issue templates name this repository.
- No committed behavior depends on an ignored private file.

## 4. Make the repository public

Settings → General → Danger Zone → Change visibility. Branch protection and
GitHub's free security features stay unavailable on a private repository, so
this step unblocks the rest.

## 5. Protect `main` and `dev`

`main` is what consumers' tags come from; `dev` is what merges into it. Both
need a ruleset that requires:

- a pull request with at least one approving review;
- the `quality` status check to pass;
- branches to be up to date before merging;
- linear history, with squash merge as the only merge method;
- no force push and no deletion.

Do not add an exemption for automation. The release workflow creates tags and
releases; it never pushes a commit into a protected branch, so it needs no
bypass. Verify with:

```bash
gh api repos/rootform-dev/action/rulesets
```

## 6. Enable the free security features

Settings → Code security: secret scanning, push protection, and Dependabot
alerts and security updates. Push protection is the layer that stops a secret
before it reaches history, which the local hooks cannot guarantee.

## 7. Reconsider the deferred scanners

`docs/adr/001-release-automation.md` defers CodeQL, Scorecard,
dependency-review, and zizmor because the repository has no application source
and a private repository exposes no dependency graph. Both conditions change
here: add them when `src/` lands, in a change that records why each one earns
its runtime.

## What stays automated

Releases. Merging `dev` into `main` derives the version from commit history and
publishes the tag and the GitHub Release together. Never create, move, or delete
a tag by hand: a published reference is what other people's workflows execute.
