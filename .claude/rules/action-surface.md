---
paths:
  - "action.yml"
  - "setup/action.yml"
  - "src/**"
  - "dist/**"
---

# Action surface rules

- The CLI owns every Rootform semantic. Never parse Terraform, derive a diff, evaluate a policy, or reinterpret an exit status in this repository.
- Every entrypoint installs through the same installer. A second download, cache, or version-resolution path is a defect.
- Resolve a version to an exact release and verify its published checksum before the binary is executed or added to `PATH`.
- Inputs and outputs are a published contract. Renaming, removing, or redefining one requires an owner-accepted spec and a migration note.
- Request the least privilege that works. Document any permission beyond `contents: read` with the behavior that needs it.
- Never write secrets, tokens, environment contents or raw Terraform inputs to logs, outputs, summaries, comments or artifacts. Step outputs contain file paths only; valid Forms and CLI reports are explicit derived evidence, allowed in enabled artifacts and human reports.
- `dist/` is generated. Rebuild it with its tool; never hand-edit it, and never commit a bundle that its source does not reproduce.
- Fail closed with a diagnostic naming the cause and the input that produced it. Silent fallback is forbidden.
