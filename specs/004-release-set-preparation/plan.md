# SPEC-004 implementation plan

## Dependency order

1. Record constitution amendment and ADR-005.
2. Replace preparation envelope and cache contract.
3. Replace orchestration outputs, artifact set, and report.
4. Update public metadata, tests, docs, and generated bundle.
5. Run focused tests, then `bun run verify`.

## Boundaries

- Rootform CLI remains sole semantic authority.
- Existing installer, analysis, diff, and comment paths stay unchanged.
- No compatibility parser for the old initialization envelope remains.
- No release, publication, network qualification, or tag mutation occurs.
