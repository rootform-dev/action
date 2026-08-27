---
paths:
  - "specs/**"
---

# Specification rules

- Product behavior starts only after matching `spec.md` has `Status: Accepted` and dated owner approval.
- Each requirement uses stable `REQ-NNN`, observable EARS acceptance, exact `Done when:` command or bounded protocol, and evidence path.
- Keep drafts explicit. Unknown product decision stays open and blocks implementation; it never becomes an invented default.
- Planning maps every accepted requirement to smallest slice and proof. Tasks cannot be marked done while evidence is `Pending`.
- Public spec stands alone without PRD, transcripts, prompts, or private roadmap.
- Semantic or hard-to-reverse uncertainty requires `$technical-spike` and ADR before production code.
