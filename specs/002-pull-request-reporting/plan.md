# SPEC-002 implementation plan

Planning starts only after `spec.md` is owner-accepted.

## Acceptance mapping

| Requirement | Smallest implementation slice | Verification command | Expected evidence |
| --- | --- | --- | --- |
| REQ-001, REQ-007 | Pure CLI diff plan and exit mapping | `bun test src/diff.test.ts` | Exact source and plan commands plus exit matrix |
| REQ-002 | Contained project-root resolution | `bun test src/run.test.ts -t "project roots"` | Nested project and unsafe-path cases |
| REQ-003, REQ-005 | Deterministic bounded Markdown renderer | `bun test src/report.test.ts` | Summary/comment snapshots and oversize fallback |
| REQ-004, REQ-008 | Event boundary and marker-owned upsert | `bun test src/pull-request.test.ts src/network-boundary.test.ts` | Same-repo, fork, missing-token, redaction cases |
| REQ-006, REQ-010 | Main orchestration and allow-listed artifact | `bun test src/main.test.ts src/entrypoints.test.ts` | Existing and diff-enabled inventories |
| REQ-009 | Real private pull request | Manual GitHub protocol | PR comment, summary, artifact, annotation, screenshots |
| REQ-011 | Complete repository proof | `bun run verify` | Local and GitHub green gates |

## Boundary ownership

- `src/diff.ts`, `src/run.ts`: CLI orchestration only; no semantic parsing.
- `src/report.ts`: GitHub-native framing around exact CLI Markdown.
- `src/pull-request.ts`: event identity, fork boundary, REST comment upsert.
- `src/main.ts`, `action.yml`: additive inputs, outputs, artifact ordering.
- `docs/adr/003-pull-request-reporting-boundary.md`: permission and API
  boundary.
- `specs/002-pull-request-reporting/evidence/`: public-safe real-run record.

## Sequence

1. Prove CLI diff commands, exit codes, project cwd, and token isolation.
2. Add deterministic report renderer and oversized-result behavior.
3. Add same-repository marker-owned comment upsert and fork skip.
4. Integrate additive action inputs, outputs, artifact files, and annotation.
5. Rebuild committed bundles and run full local gate.
6. Exercise a real private pull request with published Rootform release, then
   refine presentation from observed GitHub output.
7. Record evidence, rerun complete gates, and review final diff.

## Risks and reversibility

- Public inputs are additive and disabled by default; rollback removes them.
- Comment writer is optional and isolated from release credential.
- Action never fetches base content, avoiding privileged fork and cache risks.
- Stop if published CLI output cannot produce complete diff without semantic
  parsing in Action; product renderer then owns required change.
