# SPEC-003 implementation plan

Planning starts only after `spec.md` is owner-accepted.

## Acceptance mapping

| Requirement | Smallest implementation slice | Verification command | Expected evidence |
| --- | --- | --- | --- |
| REQ-001, REQ-002, REQ-005 | Pure preparation command builder and envelope reader | `bun test src/preparation.test.ts` | Exact command, flag matrix, failure propagation |
| REQ-003, REQ-004 | Home isolation and lock surfacing in orchestration | `bun test src/main.test.ts -t "preparation"` | Exported variable, outputs, artifact inventory |
| REQ-006, REQ-007 | Cache key derivation and restricted path set | `bun test src/cache.test.ts` | Locked and unlocked keys, excluded index path |
| REQ-008 | Credential isolation for preparation | `bun test src/network-boundary.test.ts` | Stripped environment assertions |
| REQ-009 | Preparation section in deterministic report | `bun test src/report.test.ts` | Summary snapshot without runner paths |
| REQ-010 | Setup entrypoint boundary | `bun test src/entrypoints.test.ts` | Static bundle and import assertions |
| REQ-011 | Complete repository proof | `bun run verify` | Local green gate with rebuilt bundle |

## Boundary ownership

- `src/preparation.ts`: initialization command construction, envelope reading,
  failure propagation. No Rootform semantics.
- `src/cache.ts`: key derivation and immutable path selection. No verification
  shortcut.
- `src/main.ts`, `action.yml`: additive inputs, additive outputs, home
  isolation, artifact inventory, ordering.
- `src/report.ts`: preparation presentation inside the existing deterministic
  report.
- `docs/adr/004-ci-dialect-preparation-boundary.md`: input grammar, home
  exposure, and cache scope decisions.

## Sequence

1. Prove the exact initialization command, its flag matrix, and its failure
   behavior in isolation.
2. Prove cache key derivation and the immutable path set, including the
   excluded index.
3. Integrate preparation into orchestration before analysis, isolate the home,
   and expose lock outputs.
4. Extend the report with a preparation section that carries no runner path.
5. Rebuild committed bundles and run the full local gate.

## Risks and reversibility

- New inputs default to current behavior; removing them restores the previous
  contract exactly.
- Caching is opt-out and never authoritative: with the cache disabled, or with
  a poisoned entry, the CLI still verifies every dialect by digest.
- Real network acquisition cannot be exercised while the official dialect
  source is unavailable. Preparation is therefore proven with vendored
  dialects, a preloaded home, offline mode, and injected fakes, and the
  limitation is recorded rather than hidden.
- Stop if faithful preparation would require interpreting Rootform semantics in
  Node; the CLI would then own the missing behavior.
