import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { specIdFromBranch, validateAcceptedSpec } from "./spec.ts";

const accepted = `# SPEC-001: Install one pinned CLI

- Status: Accepted
- Owner: @owner
- Owner approval: @owner — 2026-08-12

## Requirements

### REQ-001 — Verified installation

- Acceptance: WHEN a pinned version is requested THE SYSTEM SHALL verify its published checksum before the binary reaches PATH.
- Done when: \`bun test test/installer.test.ts\` exits 0.
- Evidence: \`test/installer.test.ts\`
`;

describe("accepted specification", () => {
  test("accepts complete executable proof", () =>
    expect(validateAcceptedSpec(accepted).errors).toEqual([]));

  test("template validates once every placeholder is filled", async () => {
    const template = await Bun.file(
      join(import.meta.dir, "../..", "specs/000-template/spec.md"),
    ).text();
    const filled = template
      .replace("# SPEC-NNN: Change title", "# SPEC-123: Parse fixtures deterministically")
      .replace("Created: YYYY-MM-DD", "Created: 2026-08-12")
      .replace("Updated: YYYY-MM-DD", "Updated: 2026-08-12")
      .replace("Status: Draft", "Status: Accepted")
      .replace("Owner approval: Pending", "Owner approval: @rootform-owner — 2026-08-12")
      .replace(
        "WHEN <trigger> THE SYSTEM SHALL <observable outcome>.",
        "WHEN a pinned version is requested THE SYSTEM SHALL verify its checksum.",
      )
      .replace(
        "`<command or exact manual protocol with artifact path>`",
        "`bun test test/installer.test.ts` exits 0.",
      )
      .replace("<test, fixture, snapshot, benchmark, or report path>", "`test/installer.test.ts`");
    expect(validateAcceptedSpec(filled).errors).toEqual([]);
  });

  test("rejects draft, placeholders, and circular Done when", () => {
    const invalid = accepted
      .replace("Status: Accepted", "Status: Draft")
      .replace("@owner — 2026-08-12", "Pending")
      .replace("`bun test test/installer.test.ts` exits 0.", "tests pass");
    const errors = validateAcceptedSpec(invalid).errors.join("\n");
    expect(errors).toContain("Status must be Accepted");
    expect(errors).toContain("dated owner approval is required");
    expect(errors).toContain("non-circular Done when proof");
  });

  test("rejects requirements without EARS outcome", () => {
    expect(
      validateAcceptedSpec(
        accepted.replace(
          "WHEN a pinned version is requested THE SYSTEM SHALL",
          "The installer should",
        ),
      ).errors,
    ).not.toEqual([]);
  });
});

describe("spec branch mapping", () => {
  test("extracts spec number", () =>
    expect(specIdFromBranch("feat/001-verified-install")).toBe("001"));
  test("rejects unscoped product branch", () =>
    expect(specIdFromBranch("feat/verified-install")).toBeUndefined());
});
