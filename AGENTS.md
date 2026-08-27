# Rootform Action engineering contract

These instructions apply to every human and AI contributor in this repository.
More specific `AGENTS.md` files may add local constraints but may not weaken
this contract or `docs/constitution.md`.

## Mission

This repository publishes the GitHub Actions integration for Rootform. It
installs a pinned Rootform CLI and reports what that CLI said. It is a thin,
faithful host: correctness and provenance outrank convenience features.

The Rootform product lives in `rootform-dev/rootform`. Nothing here duplicates
its parsing, diffing, policy, coverage, or exit-code semantics.

## Read order

Before changing anything:

1. Read this file and `docs/constitution.md`.
2. Read `docs/engineering/toolchain-policy.md` and
   `docs/engineering/quality-gates.md`.
3. Read the accepted spec, plan, tasks, and relevant ADRs for the change.
4. Inspect existing code and tests. Never invent a repository fact that can be
   checked.
5. Verify CLI behavior against the real `rootform` binary or its published
   documentation, never against memory.

## Change gate

- Runtime behavior requires an owner-accepted spec under `specs/`.
  Repository-only foundation work is exempt.
- A spec is accepted only when its `Status` is `Accepted` and owner approval is
  recorded with an identity and an ISO date.
- Resolve irreversible or uncertain decisions — release-asset naming, checksum
  provenance, runner support, action input grammar — with a time-boxed
  technical spike and an ADR before production code.
- Build the smallest end-to-end slice that proves the accepted outcome. Do not
  add speculative inputs, flags, abstractions, or dependencies.
- Ask before changing published action inputs or outputs, tag policy,
  licensing, security posture, or data handling.

## Product invariants

- The CLI owns every Rootform semantic. The Action never re-parses Terraform,
  re-derives a diff, re-evaluates a policy, or reinterprets an exit code.
- Every installed binary is pinned and verified against its published checksum
  before it reaches `PATH`.
- A run is deterministic: the same inputs and the same resolved CLI version
  produce the same outputs.
- The Action requests the least privilege that works and never demands a token
  it does not use.
- Secrets, tokens, absolute runner paths, and raw Terraform material never
  reach logs, outputs, job summaries, or artifacts.
- After installation the Action needs no network access.
- `dist/` is generated, committed, and provably in sync with `src/`.
- A failure is explicit. An unavailable version, a checksum mismatch, or an
  unsupported runner stops the job with a diagnostic naming the cause.

Full normative wording lives in `docs/constitution.md`.

## AI collaboration

- Primary agent owns plan, cross-cutting decisions, integration, final review,
  and completion claim.
- Prefer doing the work in the primary agent when it already holds the
  necessary context.
- Delegate only self-contained tasks with non-overlapping scopes; use subagents
  primarily for bounded investigation, isolated implementation, or independent
  verification.
- Never ask multiple subagents to independently read the same broad set of
  files. Provide distilled context in the task instead.
- Do not delegate simple edits, mechanical refactors, or work touching tightly
  coupled files.
- On any 429 or rate-limit failure, do not spawn replacement agents; continue
  sequentially in the primary agent.
- Assign one writer per file. Parallel writers must own disjoint paths.
- Every subtask returns evidence: paths and lines, commands run, observed
  output, limitations, and changed files.
- Primary agent rereads the final diff and reruns gates. Subagent claims are
  not proof.
- Never expose private prompts, transcripts, routing configuration, memory, or
  credentials in commits or logs.

## Toolchain and dependencies

- Bun is the only JavaScript package manager. Do not use npm, pnpm, Yarn, or
  auto-downloading `bunx` commands.
- Adopt the newest stable, mutually compatible versions at scaffold or upgrade
  time. Exclude alpha, beta, RC, nightly, and unverified peer combinations.
- Pin direct dependencies and tools exactly; commit lockfiles. Never edit
  generated lockfiles manually.
- Pin GitHub Actions by full commit SHA with a release tag comment.
- Add a dependency only when the accepted spec needs it and the standard
  library, the Actions toolkit already present, or existing code cannot meet
  the requirement.
- Follow `docs/engineering/toolchain-policy.md` for verification and update
  policy.

## Implementation rules

- Keep the installer and the analysis entrypoints on one code path. Two
  entrypoints that install differently are a defect.
- Keep logic deterministic and side-effect free where practical; isolate
  filesystem, network, and Actions-runtime effects behind explicit seams so
  they can be tested.
- Treat runner matrix coverage and negative cases as first-class behavior.
- Do not hand-edit generated files, lockfiles, or build output. `dist/` is
  rebuilt by its tool and verified by a gate.
- Never weaken a test or gate to make a change pass without owner-approved
  rationale.
- Comments are the exception, not the default: write one only to record an
  invariant, a security or privacy boundary, a non-obvious decision or reason,
  or an external constraint. Never paraphrase syntax, signatures, or types;
  never keep task or progress journals; never narrate a test.

## Validation

Run the narrowest relevant check while iterating, then the complete gate before
completion:

```bash
bun run verify
```

No claim of completion without command output. If a required tool is
unavailable, report the exact missing proof; do not substitute confidence.

## Git workflow

- Branch from `develop` using `type/NNN-short-kebab-slug` for product specs and
  `type/short-kebab-slug` for repository-only work.
- Open pull requests into `develop`; use squash merge.
- Use Conventional Commits: `type(scope): imperative summary`.
- Keep subject at most 100 characters, lower-case, and without trailing period.
- Do not push directly to `main` or `develop`.
- Do not use `--no-verify`, force push, destructive reset, or history rewriting
  unless the owner explicitly authorizes it.
- Do not add automatic AI attribution or co-author trailers. Describe material
  design decisions and evidence in the pull request.
- One commit should express one coherent reason for change.

## Versioning

While this repository is pre-release, every version stays `0.1.0`. Published
major tags are cut by the owner, never by an agent.

## Definition of done

A change is done only when:

- accepted outcomes and invariants are met;
- tests cover success, boundary, failure, and regression paths in proportion to
  risk;
- format, static checks, tests, bundle sync, foundation validation, and secret
  scan pass;
- documentation, spec, ADR, task evidence, and pull request evidence are
  updated where relevant;
- final diff contains no unrelated edits, secrets, private material, generated
  noise, or unexplained dependency changes;
- primary reviewer records remaining limitations honestly.
