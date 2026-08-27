---
name: technical-spike
description: Resolve a risky Rootform Action assumption before production implementation. Use for uncertain release-asset naming, checksum provenance, runner platform support, bundler or Node runtime behavior, action input grammar, caching, or another hard-to-reverse decision requiring evidence.
---

# Rootform Action technical spike

Run a time-boxed experiment that answers one decision question. Spike output is evidence, not production code.

## Workflow

1. State one falsifiable question and why wrong choice would be costly.
2. Record current evidence, unknowns, and competing hypotheses.
3. Verify current stable versions and behavior from official primary sources.
4. Define time box, smallest disposable experiment, fixture, and measurable pass/fail criteria.
5. Keep experiment outside production paths unless owner explicitly chooses promotion.
6. Run experiment and preserve commands, versions, outputs, and limitations.
7. Compare credible options against this repository's constitution: CLI ownership of semantics, verified installation, one installer, least privilege, determinism, data minimization, and a bundle that reproduces from source.
8. Write ADR using `docs/adr/000-template.md`: decision, alternatives, consequences, validation, and reversal path.
9. Remove disposable artifacts or keep them only as intentional synthetic test fixtures.

## Constraints

- No vendor blog or model memory as sole evidence when official docs, source, release notes, or reproducible behavior exist.
- No prerelease dependency unless owner explicitly requests evaluation; never promote it silently.
- No production implementation before owner accepts resulting spec or ADR.
- A failed or inconclusive spike is valid evidence; state what remains unknown.

## Output

Return question, verdict, evidence paths, commands, version snapshot, ADR path, and next owner decision.
