# Public/private repository boundary

Rootform intends to become public. Public history must be useful, auditable, and safe without publishing private product strategy or internal AI operations.

## Keep in Git

- source, tests, synthetic fixtures, accepted public specs, and ADRs;
- `AGENTS.md`, constitution, contribution and security policies;
- generic reusable skills under `.agents/skills/` and their Claude aliases;
- shared Claude/Codex guardrail mappings, path-scoped technical rules, Git hooks, validation scripts, secret-scanning policy, CI, and pull request templates;
- exact manifests, lockfiles, dependency policy, and reproducible build configuration;
- decisions required to understand, build, verify, or maintain public behavior.

## Keep local and ignored

- private PRD, business strategy, detailed roadmap, unpublished research, and draft positioning;
- model routing, detailed orchestration prompts, agent profiles, transcripts, memory, traces, cost data, and local plans;
- personal permission overrides and provider-specific local settings not required to enforce shared repository policy;
- credentials, environment values, personal paths, editor state, caches, and generated reports;
- real Terraform source, plans, state, account identifiers, customer data, or unredacted incident material.

Canonical ignored paths include `prd.md`, `docs/internal/`, `.ai-private/`, `.codex/config.toml`, `.claude/settings.local.json`, private `.claude/` agents and plans, `*.private.md`, and local progress files.

## Promotion rule

Private material must never be required to build, test, or understand committed behavior. Before product work relies on a private decision, promote the minimum durable rationale and acceptance criteria into an accepted public spec or ADR. Remove business-sensitive detail and personal data during promotion.

## Controls and limits

`.gitignore` prevents accidental selection; it is not a security boundary. Tracked secrets remain in history after deletion. Local hooks block common mistakes, CI scans full history, and GitHub secret scanning provides another layer. Before every public release, review complete history and repository metadata.

When uncertain, keep material private and ask the owner. Do not silently hide engineering behavior required for public trust.
