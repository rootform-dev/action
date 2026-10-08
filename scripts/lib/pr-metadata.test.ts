import { describe, expect, test } from "bun:test";
import { validatePullRequestMetadata } from "./pr-metadata.ts";

const validBody = `## Change

Repository tooling validates contributions before publication.

## Validation

bun run verify passed.
`;

describe("pull request metadata", () => {
  test("accepts concise change and validation", () => {
    expect(
      validatePullRequestMetadata("fix: validate public contributions", validBody).errors,
    ).toEqual([]);
  });
  test("rejects absent validation and template placeholders", () => {
    expect(
      validatePullRequestMetadata(
        "fix: validate public contributions",
        "## Change\n\nImproved checks.",
      ).errors,
    ).toContain("missing pull request section: Validation");
    expect(
      validatePullRequestMetadata("fix: validate public contributions", `${validBody}\nTODO`)
        .errors,
    ).not.toEqual([]);
  });
  test("refuses unsafe text without reproducing it", () => {
    const value = "/" + "Users/fixture/private";
    const errors = validatePullRequestMetadata(
      "fix: validate public contributions",
      `${validBody}\n${value}`,
    ).errors;
    expect(errors).toEqual(["unsafe public contribution text"]);
    expect(errors.join(" ")).not.toContain(value);
  });
});
