# SPEC-001 implementation plan

## Acceptance mapping

| Requirement | Slice | Proof |
| --- | --- | --- |
| REQ-001, REQ-002 | Release API, asset selection, checksum/digest verification | `bun test src/install.test.ts src/github.test.ts` |
| REQ-003 | Shared installer used by setup and main | `bun test src/entrypoints.test.ts` |
| REQ-004, REQ-005 | Source/plan command plans and exit-code gate | `bun test src/run.test.ts` |
| REQ-006, REQ-007 | Summary, artifact allow-list, network boundary | `bun test src/main.test.ts src/network-boundary.test.ts` |
| REQ-008 | Node 24 manifests and deterministic bundles | `bun run build && bun run verify:dist` |
| REQ-009 | Full repository proof | `bun run verify` |

## Sequence

1. Record stable runtime, dependency, asset, and token decisions in ADR-002.
2. Implement pure release parsing, asset selection, checksum, and platform map.
3. Implement shared installer and setup entrypoint.
4. Implement source/plan command plans, result files, summary, artifact upload,
   and exit gate.
5. Add manifests, build deterministic bundles, extend gates, and run clean
   private-release integration.

## Rollback

Remove `action.yml`, `setup/`, `src/`, and generated `dist/`; drop runtime
dependencies and bundle gates. Existing repository history and release
automation remain. No published tag moves or disappears.
