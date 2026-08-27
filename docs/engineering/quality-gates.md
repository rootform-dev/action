# Quality gates

Every durable rule needs an executable control and a testable completion condition. Documentation states intent; local hooks give fast feedback; CI remains authoritative.

## Enforcement matrix

| Rule | Preventive control | Executable check | Done when |
| --- | --- | --- | --- |
| Private material never enters Git | `.gitignore`, agent `PreToolUse`, staged-path hook | `bun scripts/validate-foundation.ts` | Canonical private probes are ignored and no candidate Git path matches private policy. |
| No secret or Terraform runtime artifact | agent `PreToolUse`, staged-path hook, GitHub push protection | Gitleaks staged scan, public working-set scan, and full-history scan | All three scans exit `0`; no `.env`, key, state, or plan path is a Git candidate. |
| Bun is sole JavaScript package manager | policy hook blocks alternatives; foreign lockfiles rejected | exact Bun check plus frozen install in CI | Runtime equals `packageManager`; `bun install --frozen-lockfile` exits `0`; no foreign lockfile exists. |
| Dependencies and tools are immutable | exact manifest versions, committed lockfile, SHA-pinned Actions | foundation validator | Every direct version is exact, lockfile is present, every remote Action ref is a 40-character SHA. |
| Published bundle matches its source | `PreToolUse` blocks hand-edits to `dist/` | bundle rebuild and `git status --porcelain -- dist` in verify | Rebuilding from `src/` leaves `dist/` unchanged; a stale bundle fails the gate. |
| Published entrypoint is runnable | action manifest validation | `bun scripts/validate-foundation.ts` | Each `action.yml` names a non-empty name and description, a pinned Node runtime, and an existing committed bundle. |
| Agent cannot overwrite governed/generated files | `PreToolUse` blocks `LICENSE`, lockfiles, PRD, secrets, state, plans, build output | policy unit tests | Every deny fixture returns explicit reason; safe fixtures remain allowed. |
| Published tag or release is not moved by automation | `PreToolUse` blocks `git tag -f`, tag deletion, and `gh release` mutation | policy unit tests | Every consumer pinned to a major tag keeps the code it was reviewed against. |
| Release is derived from history, not chosen by hand | semantic-release on `main`; release plugins restricted | `bun scripts/validate-foundation.ts` | Release config targets only `main`, keeps `v${version}`, maps a breaking change to a minor bump, and declares no publishing or repository-writing plugin. |
| Workflow definition is statically valid | actionlint installed from a checksum-verified archive in CI | `actionlint` gate inside `bun run verify` | actionlint 1.7.12 exits `0` over `.github/workflows`. |
| Destructive or bypass command is not automated | `PreToolUse` blocks destructive Git/filesystem/Terraform and `--no-verify` | policy unit tests | Deny matrix passes for every supported command form. |
| Touched source uses the pinned formatter | `PostToolUse` invokes installed Biome | Biome check and format-hook tests | Hook never invokes `bunx`; formatter check exits `0`. |
| Commit and PR history remains reviewable | `commit-msg` hook and PR metadata CI | Conventional Commit validator | Valid fixtures pass; invalid type, casing, length, suffix, and bypass cases fail. |
| Product work has accepted outcome | spec workflow, PR metadata gate | spec validator and PR validator | Spec status is `Accepted`, owner approval recorded, no placeholder remains, each requirement has executable `Done when:` proof. |
| Completion claims are evidence-backed | agent `Stop`, `pre-push`, CI | fast or full verification runner | Fast gate passes before agent stops; full gate passes before push and in clean CI checkout. |
| Public repository remains understandable alone | promotion rule and public templates | foundation validator plus final diff review | No committed behavior depends on ignored PRD, prompts, transcript, memory, or local rule file. |

## Gate levels

### Fast gate

Runs foundation policy, format checks, and tooling unit tests. Used by agent `Stop` and during iteration:

```bash
bun run check:fast
```

### Full gate

Runs the fast gate, the product spec gate, workflow static analysis, the public working-set secret scan, the full Git history scan, and — once `src/` exists — the bundle rebuild and sync check:

```bash
bun run verify
```

Missing required tooling fails closed: the full gate refuses to run without Gitleaks 8.30.1 and actionlint 1.7.12 at their exact pinned versions. A skipped, unavailable, or failing gate must be reported as missing proof.

## Accepted spec requirement shape

Every behavior requirement uses stable identifier and executable outcome:

```markdown
### REQ-001 — Stable title

- Acceptance: WHEN <trigger> THE SYSTEM SHALL <observable outcome>.
- Done when: `<command or exact manual protocol with artifact path>`
- Evidence: `<test, fixture, snapshot, benchmark, or report path>`
```

`Done when:` cannot be “works”, “looks correct”, “tests pass”, or another circular claim. It names command or bounded protocol and observable result.

Hooks never evaluate arbitrary commands copied from Markdown. Reviewed package scripts and test targets execute proofs; manual protocols record bounded artifacts for primary review.

## Trust boundary

Hooks are guardrails, not sandbox. They can be disabled locally and cannot safely parse every shell program. CI, GitHub controls, least-privilege tokens, final review, and repository history scan provide independent layers. No control justifies committing secrets.
