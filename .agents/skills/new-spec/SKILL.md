---
name: new-spec
description: Create or refine a Rootform Action change specification before behavior is implemented. Use for action inputs and outputs, installation and verification rules, gating, published artifacts, permissions, data handling, or any request whose acceptance criteria are not already owner-approved.
---

# New Rootform Action spec

Turn product intent into a small, reviewable contract. Do not implement product code while using this skill.

## Workflow

1. Read `AGENTS.md`, `docs/constitution.md`, relevant ADRs, and the minimum private owner context available.
2. Search existing specs and code. Separate verified repository facts from assumptions.
3. Choose the next three-digit spec number and a short kebab-case name under `specs/`.
4. Copy `specs/000-template/` to that directory.
5. Define one bounded outcome, explicit non-goals, affected invariants, and open questions.
6. Write acceptance criteria in EARS form where useful: `WHEN ... THE SYSTEM SHALL ...`.
7. Give each criterion a runnable `Done when:` proof. Cover success, boundary, failure, determinism, privacy, and least-privilege behavior when relevant.
8. Confirm the Rootform CLI already exposes every behavior the spec assumes. A missing capability is a CLI feature request, not an action requirement.
9. Mark uncertain release-asset, checksum, runner, or input-grammar claims for `$technical-spike`; do not encode guesses as requirements.
10. Keep status `Draft`. Ask product owner to accept spec before creating implementation plan or product code.

## Constraints

- Public spec must stand alone without private PRD, transcripts, or prompts.
- No implementation details unless they are genuine constraints.
- No speculative future scope or hidden follow-up work.
- No version claim without same-day official-source verification.
- No published input, output, or tag meaning changed without a recorded migration.
- No `Accepted` status without explicit owner decision.

## Output

Return spec path, unresolved decisions, proposed proofs, and explicit request for owner acceptance.
