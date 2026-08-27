import { describe, expect, test } from "bun:test";
import { validatePullRequestMetadata } from "./pr-metadata.ts";

const validBody = `## Spec and outcome

- Spec or repository-only rationale: repository foundation
- Accepted outcome: shared checks run locally and in CI
- Explicit non-goals: no product code

## Done when and evidence

- Done when command or protocol: bun run verify exits 0
- Evidence path or exact output: CI quality job

## Risk and privacy

- Security/privacy impact: private PRD stays ignored
- Offline and determinism impact: no product runtime
- Dependency or toolchain change: exact foundation tooling only
- Rollback path: revert this pull request

## Review checklist

- [x] one
- [x] two
- [x] three
- [x] four
`;

describe("pull request metadata", () => {
  test("accepts completed template", () => {
    expect(
      validatePullRequestMetadata("chore: establish repository foundation", validBody).errors,
    ).toEqual([]);
  });

  test("rejects empty fields and checklist", () => {
    const body = validBody.replace("repository foundation", "").replaceAll("[x]", "[ ]");
    const errors = validatePullRequestMetadata(
      "chore: establish repository foundation",
      body,
    ).errors.join("\n");
    expect(errors).toContain("Spec or repository-only rationale");
    expect(errors).toContain("review checklist");
  });

  test("rejects unresolved template marker", () => {
    expect(
      validatePullRequestMetadata(
        "chore: establish repository foundation",
        `${validBody}\n<!-- required: x -->`,
      ).errors,
    ).not.toEqual([]);
  });
});
