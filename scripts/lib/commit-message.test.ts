import { describe, expect, test } from "bun:test";
import { validateCommitSubject } from "./commit-message.ts";

describe("Conventional Commit policy", () => {
  test.each([
    "chore: initialize repository",
    "docs(governance): define privacy boundary",
    "feat(parser)!: reject unsupported syntax",
    "test(spec): cover unknown resources",
  ])("accepts %s", (message) => expect(validateCommitSubject(message)).toEqual({ valid: true }));

  test.each([
    "update things",
    "feature: add parser",
    "feat: Add parser",
    "feat: add parser.",
    "feat(scope with spaces): add parser",
    "feat: add parser\n\nCo-authored-by: Claude <bot@example.com>",
  ])("rejects %s", (message) => expect(validateCommitSubject(message).valid).toBe(false));

  test("rejects subjects above 100 characters", () => {
    expect(validateCommitSubject(`docs: ${"x".repeat(95)}`).valid).toBe(false);
  });
});
