# SPEC-NNN implementation plan

Planning starts only after matching `spec.md` is owner-accepted.

## Acceptance mapping

| Requirement | Smallest implementation slice | Verification command | Expected evidence |
| --- | --- | --- | --- |
| REQ-001 | <slice> | `<command>` | `<artifact or exact output>` |

## Boundary ownership

List affected layers and owner for each file set. Keep parallel writers on disjoint paths.

## Sequence

1. Add failing proof for accepted outcome.
2. Implement smallest vertical slice.
3. Verify boundary and failure cases.
4. Run full gate and privacy review.

## Risks and reversibility

Record irreversible choices, spike/ADR needs, rollback path, and explicit stop condition.
