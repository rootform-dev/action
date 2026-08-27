---
name: verify
description: Prove a Rootform Action change against repository gates and accepted outcomes. Use before claiming completion, before a commit or pull request, after dependency, bundle, or workflow changes, and when asked to validate existing work without expanding scope.
---

# Verify the Rootform Action

Produce evidence, not confidence. Verification does not authorize unrelated fixes.

## Workflow

1. Read accepted spec, plan, tasks, relevant ADRs, and current diff.
2. Map every changed behavior to an acceptance criterion or repository-only requirement.
3. Run narrow checks first when diagnosing a failure.
4. Run complete gate from repository root:

   ```bash
   bun run verify
   ```

5. Inspect diff for unrelated edits, private material, secrets, generated noise, lockfile anomalies, and weakened tests.
6. If behavior changed, exercise realistic success, boundary, failure, and regression paths. Include determinism, redaction, least-privilege, and bundle-sync checks when applicable.
7. Report exact commands, exit status, important output, unproven claims, and environmental limits.

## Stop conditions

- Do not repair failures unless task also authorizes implementation.
- Do not replace missing required proof with a lighter check.
- Do not claim CI, runner-matrix, or published-release evidence that was not observed.
- Do not mark work complete while required gate fails or accepted outcome remains untested.

## Output

Return concise pass/fail matrix: requirement, evidence, result, and remaining limitation.
