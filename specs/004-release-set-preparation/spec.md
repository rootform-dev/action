# SPEC-004: Release-set project preparation

- Status: Accepted
- Owner: @soulbah
- Owner approval: @soulbah — 2026-09-14 (explicit RF Language and
  Architecture IR v0.1 replacement directive)
- Created: 2026-09-14
- Updated: 2026-09-14
- Related ADR: ADR-005

## Problem

Rootform now ships RF Vocabulary and supplied Dialects inside one immutable
release set. The Action still describes provider discovery, separately
installed supplied Dialects, generated locks, and an official Dialect index.
Those behaviors no longer exist. They also cause the Action to cache and report
the wrong state.

## Outcome

The Action remains a thin CLI host. Before analysis it invokes `rootform init`
once to verify or acquire only exact non-embedded selections already recorded
in `rootform.lock`: Dialects and Policy Pack sources. A missing lock
is an empty selection unless `locked` is enabled. Preparation never writes a
lock, resolves providers, or acquires supplied Dialects.

## Non-goals

- Parsing a lock, Terraform, RF, or Architecture IR in the Action.
- Selecting, upgrading, or publishing any semantic unit.
- Caching supplied Dialects, RF Vocabulary, linked artifacts, or mutable state.
- Changing Rootform analysis, diff, policy, renderer, or installer semantics.
- Publishing an Action release or moving a tag.

## Requirements

### REQ-001 — Exact CLI preparation

The Action SHALL run `rootform init <path> --format json --no-input` exactly
once before analysis, map `locked` and `offline` to their same-named flags,
and treat any non-zero exit as a preparation failure without fallback.

### REQ-002 — Machine envelope

The Action SHALL accept only preparation envelope format `1`, `prepared: true`,
bounded Dialect and Policy Pack unit arrays, non-negative downloaded bytes,
and the CLI's closed `verified` or `acquired` status. It SHALL report those
fields without deriving another Rootform decision.

### REQ-003 — Lock ownership

Preparation SHALL never create, copy, upload, stage, commit, or claim to create
`rootform.lock`. The Action SHALL expose `lock-path` only when a lock already
exists. `locked` SHALL require that file through CLI behavior.

### REQ-004 — Immutable external-package cache

Optional cache SHALL contain only Rootform-home `dialects/` and
`policy-packs/`. It SHALL exclude supplied semantics, temporary content,
linked artifacts, and discovery state. Cache keys SHALL bind exact Rootform
version, execution mode, platform, and lock digest when present. Cache restore
never skips CLI verification.

### REQ-005 — Honest public surface and report

Output `preparation-mode` SHALL replace `resolution-mode`; `lock-created` SHALL
be removed. Reports SHALL show preparation mode, exact Dialects, exact Policy
Packs, downloaded bytes, and existing lock path. They SHALL make no provider
coverage or supplied-Dialect installation claim.

### REQ-006 — Isolation, credentials, and network

Rootform home SHALL remain isolated under runner temporary storage and absent
from outputs, reports, and artifacts. Preparation SHALL receive the existing
credential-stripped CLI environment. Analysis commands SHALL remain offline;
only explicit preparation may acquire exact OCI pins already present in lock.

### REQ-007 — Complete proof

Source tests, bundle-sync proof, static checks, foundation validation, and full
repository gate SHALL pass before release.
