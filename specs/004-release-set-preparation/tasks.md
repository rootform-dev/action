# SPEC-004 tasks

## T001 — Record replacement contract

- Status: Complete
- Evidence: SPEC-004, ADR-005, constitution amendment

## T002 — Replace preparation and cache

- Status: Complete
- Evidence: `src/preparation.ts`, `src/cache.ts`; typecheck and focused tests
  passed locally on 2026-09-14. External Dialect unit surface renamed from
  `extensions` to `dialects` to match the CLI envelope and home layout.

## T003 — Replace orchestration and reporting

- Status: Complete
- Evidence: `src/main.ts`, `src/report.ts`, public action metadata and tests;
  28 focused tests passed locally on 2026-09-14; report and action metadata
  now speak Dialects and Policy Packs, with no `extensions` alias.

## T004 — Final repository proof

- Status: In progress
- Evidence: source-only `bun run check` passes on 2026-09-14. Bundle rebuild
  and `verify:dist` remain deliberately deferred until owner validation;
  `bun run verify` also requires Gitleaks and actionlint on `PATH`.
