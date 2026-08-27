# Rootform Action constitution

This document defines non-negotiable invariants for the Rootform GitHub Actions
integration. Specs and ADRs may refine them but may not silently weaken them.
Amendments require explicit product-owner approval, rationale, repository
impact, and a dedicated ADR.

## I. The CLI owns every Rootform semantic

The Action installs the Rootform CLI, invokes it, and reports what it said. It
never parses Terraform, derives a diff, evaluates a policy, computes coverage,
or reinterprets an architecture. A behavior the CLI does not expose is a CLI
feature request, not an Action feature.

## II. Exit codes are read, never invented

Rootform's documented exit statuses are the only source of pass, fail, and
undecided. The Action maps them to job outcomes and never synthesizes a verdict
from parsed output.

## III. Verified installation

Every downloaded binary is resolved to an exact version and verified against
its published checksum before it is executed or placed on `PATH`. A mismatch
aborts the job. An unverifiable asset is never used, and a partially installed
toolchain is never left on `PATH`.

## IV. One installer

Every entrypoint in this repository installs through the same code path. A
second installation strategy, cache layout, or version resolution rule is a
defect, not a feature.

## V. Least privilege

The Action requests the minimum GitHub permissions its accepted behavior needs
and never requires a credential it does not use. Any permission beyond
`contents: read` is documented with the behavior that requires it. The Action
never writes to a repository, a pull request, or a check unless an accepted
spec grants that behavior.

## VI. Deterministic runs

Identical inputs and an identical resolved CLI version produce identical
outputs, artifacts, and gating decisions. Time, runner identity, and ordering
of filesystem enumeration never change a result.

## VII. Data minimization

Secrets, tokens, absolute runner paths, environment contents, and raw Terraform
material never reach logs, step outputs, job summaries, or artifacts. What is
published is what an accepted spec requires and nothing more.

## VIII. Offline after install

Beyond resolving and downloading the pinned CLI release, a run performs no
network access. No telemetry, analytics, call-home, or CDN dependency exists at
any point.

## IX. The bundle is generated and proven

`dist/` is build output that must be committed for GitHub to run the Action. It
is never hand-edited, and a gate proves it matches `src/` byte for byte.

## X. Explicit failure

An unavailable version, a checksum mismatch, an unsupported runner platform, an
invalid input combination, or a missing CLI capability stops the job with a
diagnostic that names the cause and the input that produced it. Silent fallback
and best-effort degradation are forbidden.

## XI. Small verified changes

Implementation proceeds in narrow vertical slices backed by executable
evidence. Dependencies and abstractions require present need. Tests cover
positive, negative, boundary, determinism, and redaction behavior in proportion
to risk.

## XII. Published surface is a contract

Action inputs, outputs, and tag semantics are a public API. Renaming, removing,
or changing the meaning of one requires an owner-approved spec and a documented
migration.

## Amendment record

- 2026-08-27 — @soulbah: initial constitution recorded when the repository was
  scaffolded from the Rootform engineering foundation.
