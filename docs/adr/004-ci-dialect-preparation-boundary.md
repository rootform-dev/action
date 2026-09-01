# ADR-004: Continuous integration dialect preparation boundary

- Status: Accepted
- Date: 2026-09-01
- Owners: @soulbah
- Owner approval: @soulbah — 2026-09-01 (explicit directive to make Rootform
  runnable in any CI with vendored dialects, a committed lock, or no lock at
  all, without duplicating Rootform resolution logic in the Action)
- Related spec: `specs/003-ci-dialect-preparation/spec.md`

## Context

Until this change the Action installed a pinned CLI and analyzed a project that
was assumed to be ready. A repository whose dialects were neither vendored under
`.rootform/dialects` nor already installed in a Rootform home failed inside
`rootform build`, and the caller saw an analysis error rather than a missing
preparation step.

The CLI now owns that step. Verified against the Rootform CLI on 2026-09-01:

- `rootform init [path]` resolves providers, selects dialects, acquires what is
  missing, and writes `rootform.lock`. The path argument defaults to `.`.
- Its flags are `--format`, `--locked`, `--no-input`, `--offline`, `--upgrade`,
  and `--verbose`. There is no `--frozen`: it would only be an ambiguous alias
  of `--locked --offline`.
- `--format json` prints one envelope on stdout carrying `format_version`,
  `providers_detected`, `dialects[]`, `download_size`, `lock_written`,
  `unsupported_providers[]`, `incompatible_providers[]`, and `warnings[]`.
  Prompts and diagnostics stay on stderr.
- Documented exits are `0` success, `1` failure, `2` misuse, and `3` no
  deterministic resolution.
- `CI=true` already forces non-interactive behavior, and `--no-input` states it
  explicitly rather than depending on runner environment detection.
- The home layout is `dialects/`, `cache/`, `indexes/`, `tmp/`, with
  content-addressed blobs under `cache/blobs/sha256/`.

Verified GitHub behavior on 2026-09-01:

- `@actions/cache` 6.2.0 exposes `restoreCache(paths, primaryKey, restoreKeys)`
  returning the matched key or `undefined`, and `saveCache(paths, key)`.
- `core.exportVariable` writes to `GITHUB_ENV`, so a value set by one step is
  visible to every later step in the job, while `core.setOutput` publishes a
  value into workflow-visible output.
- `RUNNER_TEMP` is emptied between jobs, which makes it the correct location for
  per-job state that must not leak across jobs.

## Decision

- Preparation runs exactly once per job, before any build, check, or diff
  command, by invoking the CLI initialization command. The Action derives its
  reported outcome only from that command's envelope and exit status, and never
  recomputes a Rootform decision in Node.
- Execution mode is expressed as two independent boolean inputs, `locked` and
  `offline`, which map to the CLI's own flags. `--no-input` is always passed.
- The Rootform home is created under `RUNNER_TEMP`, exported as `ROOTFORM_HOME`
  for later steps, and never published as an output, in the Job Summary, or in
  an artifact.
- A lock generated during the run is surfaced through `lock-created` and
  `lock-path`, copied into the uploaded artifact, and announced in the Job
  Summary as something the caller should commit. The Action never stages,
  commits, or pushes it.
- A non-zero initialization exit fails the job with the CLI diagnostic, runs no
  analysis command, publishes no analysis exit code, and leaves the project lock
  untouched.
- Caching is opt-out and restores only installed dialects and content-addressed
  blobs. The official index and `tmp/` are excluded. The key derives from the
  lock digest when a lock exists, and otherwise stays coarse with restore
  prefixes and a run-unique suffix.
- A restored entry is a starting point, never an authority: preparation always
  runs afterwards so the CLI re-verifies every dialect by digest.
- Preparation receives the same credential-stripped environment as every other
  CLI command. No release token and no pull-request token reaches the CLI.
- The `setup` entrypoint remains an installer and gains nothing from this
  change.

## Alternatives considered

- **A single `dialects: auto | locked | offline | locked-offline` enum.**
  Rejected: `locked` and `offline` are two independent dimensions in the CLI,
  collapsing them would misrepresent that grammar, and the enum would have to
  grow a new member for every future combination such as `--upgrade`.
- **A `--frozen` shorthand.** Rejected for the same reason the CLI rejects it:
  it is an ambiguous alias of `--locked --offline` and hides which constraint
  actually failed.
- **Publishing the Rootform home as an output.** Rejected: it is an absolute
  runner path and constitution VII keeps those out of outputs, summaries, and
  artifacts. Exporting `ROOTFORM_HOME` gives later steps the same capability
  without publishing the value.
- **Reusing an ambient or repository-local Rootform home.** Rejected: two jobs
  would then share mutable dialect state, and a run could observe a store it did
  not verify.
- **Committing the generated lock from the Action.** Rejected: it needs write
  credentials, mutates caller repository content, and hides a decision the
  caller must review. Surfacing the file as evidence keeps ownership with the
  caller.
- **Caching the whole Rootform home.** Rejected: `indexes/` is mutable selection
  state, and sharing it between two revisions of a pull request would let one
  revision decide what the other resolves.
- **Deriving the cache key from provider names.** Rejected: it leaks project
  shape into the cache namespace and invalidates as soon as a provider is added.
- **Skipping preparation on a cache hit.** Rejected: the cache would become an
  authority, and a poisoned or stale entry would silently change a result.
- **Making `setup` prepare dialects.** Rejected: it would give one entrypoint
  two responsibilities and make an installation step acquire content.

## Consequences

Existing callers keep their behavior: the new inputs default to the previous
contract, and a project that was already vendored or already installed is
prepared without acquiring anything. A repository with no lock now completes its
first run and receives the generated lock as evidence instead of failing inside
analysis.

Preparation is the only Action step allowed to acquire dialects, which narrows
the network surface to one command with a documented envelope. `offline` removes
even that.

Cache misses, cache service errors, and poisoned entries are all equivalent to a
slower run rather than to a different result, because verification happens after
restoration.

## Validation

Primary-source evidence:

- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables
- https://docs.github.com/en/actions/reference/workflows-and-actions/variables
- https://github.com/actions/toolkit/tree/main/packages/cache
- https://github.com/actions/toolkit/tree/main/packages/core

CLI observation:

```text
rootform 0.1.0
rootform init --help
rootform init . --format json --no-input --locked --offline
```

Implementation proof:

```bash
bun test src/preparation.test.ts src/cache.test.ts src/main.test.ts \
  src/report.test.ts src/entrypoints.test.ts src/network-boundary.test.ts
bun run verify
```

Real network acquisition cannot be exercised while the official dialect source
is unavailable. Preparation is therefore proven with vendored dialects, a
preloaded home, offline mode, and injected fakes, and that limitation is
recorded rather than hidden.

## Reversal

Remove the additive inputs and outputs, the preparation and cache modules, the
preparation section of the report, and the home isolation. Existing SPEC-001
analysis and SPEC-002 reporting behavior remains untouched, because preparation
is ordered before them and shares no state with them beyond the resolved dialect
set the CLI itself owns.
