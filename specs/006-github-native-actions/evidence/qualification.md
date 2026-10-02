# Public Action qualification

Date: 2026-10-02. Lead review covers SPEC-006 and ADR-006. All hosted runs below
used public repositories, published release assets and public synthetic
fixtures. No private producer workflow or locally built CLI was used.

## Exact identities

- Qualified runtime/manifests/bundles:
  `aa619a35a674a0be901650379db3b0551ee645ad` in rootform-dev/action.
- Consumer: rootform-dev/action-qualification, PR 1; final test revision
  `ce1e85c4c37747da3d6958305173ea6f8210ef4f`.
- CLI immutable prerelease: `0.1.0-pr.117.1`; public fixture commit
  `74bd643f3001a37f8b4f881c0ae33db047b6aba3` in rootform-dev/rootform.
- Delivery: [Action PR 19](https://github.com/rootform-dev/action/pull/19).
  First v1 publication uses the create-only maintainer workflow at current
  reviewed merged dev after its exact-SHA quality run succeeds. Documentation,
  integration proofs and publication workflow added after the qualified runtime
  leave src/, dist/ and all six manifests identical to the qualified commit.

## Evidence

| Proof | Result and public run |
| --- | --- |
| Action full gate | [quality 37007530078](https://github.com/rootform-dev/action/actions/runs/37007530078): passed; 115 tooling and 77 runtime tests, 679 assertions, static/workflow checks, secret scans, generated-bundle correspondence |
| Native matrix | [37007845589](https://github.com/rootform-dev/action-qualification/actions/runs/37007845589): five passed jobs on ubuntu-24.04, ubuntu-24.04-arm, macos-15-intel, macos-15, windows-2025 |
| Autonomous entrypoints | Native jobs install/verify published bytes, analyze with paired saved plan, reuse exact Form path/digest, compare mixed operands with independently paired saved plan, check both comparison sides |
| Negative gate | Every native job receives genuine exit 1, failed step outcome, valid Form/result/report/SARIF and downloadable artifact before gate |
| Artifact inventories | Each native job downloads its negative artifact and verifies exactly four derived files. Integrated consumer downloads exactly five files including HTML; no raw inputs or operand Forms |
| Cache and offline init | [37007845642](https://github.com/rootform-dev/action-qualification/actions/runs/37007845642): fresh source acquisition from isolated TLS registry, SDK source save, another job's exact-key restore, locked offline re-verification with no registry, source present and seeded cache/tmp markers absent |
| Integrated reporting | [37007845525](https://github.com/rootform-dev/action-qualification/actions/runs/37007845525): root multi-output union, genuine negative gate, artifact, Summary and updated existing bot comment |
| Obsolete HEAD | [37007553675 attempt 2](https://github.com/rootform-dev/action-qualification/actions/runs/37007553675/attempts/2): older HEAD rerun succeeds without changing current comment ID or body |

One bot comment was created, then updated on a new HEAD:
[comment 5952449276](https://github.com/rootform-dev/action-qualification/pull/1#issuecomment-5952449276).
Lead downloaded integrated evidence and checked that its complete report.md is
present verbatim in that comment. Comment transport adds only framing and run,
version and artifact links. No semantic result JSON was interpreted.

Local integration additionally passed ten real CLI cases: plan analysis,
saved Form reuse, mixed comparison, Comparison Form reopen with unchanged path
and bytes, Comparison Form refused as operand (exact exit 2), direct plan
check, both-side comparison check, violation (1), no verdict (3), and state.
Cold Node 24 installation and isolated network-disabled OCI proof are recorded
in [preflight](preflight.md).

## Review findings and limits

- Fixed before hosted CI: manifest checksum crosscheck, actual SDK artifact-ID
  response handling, token-isolated subprocesses, stable home path for cache
  version hashing, online/offline-independent exact lock keys and no coarse
  cross-lock fallback.
- First public cache run restored and verified offline successfully, but a test
  incorrectly required the derived cache directory to be absent. CLI may create
  an empty directory. Corrected proof seeds excluded content before save and
  proves that content does not restore. Production cache boundary was unchanged.
- Fork comment skip, privileged-target rejection before installation, current
  run/attempt/HEAD guards, duplicate comments and permission failures have
  runtime tests. Native reporter concurrency is required: REST comments have no
  atomic conditional update. GHES artifacts/comments remain unsupported as
  documented; same-job files work with upload disabled.
- Existing official baseline GHCR package has an obsolete manifest, as
  described in preflight. It was neither changed nor used to qualify current
  source acquisition. Its future official publication belongs to Rootform
  distribution, not this Action redesign.
- Release bytes and exact version were verified; no compiler-build provenance
  attestation is claimed. Current published CLI is a prerelease, not stable
  0.1.0. Qualify the chosen stable release before changing example CLI pins.

The first v1 workflow refuses an existing ref and requires exact current dev,
merged dev PR and successful exact-SHA quality. Future ref updates need a
separate reviewed decision; this qualification grants no tag rewrite.
