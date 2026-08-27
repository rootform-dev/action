import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./lib/git.ts";

const root = join(import.meta.dir, "..");

describe("commit range command", () => {
  test("accepts one valid commit without a phantom empty subject", () => {
    const repository = mkdtempSync(join(tmpdir(), "rootform-commit-range-"));
    try {
      expect(git(["init", "--quiet"], repository).exitCode).toBe(0);
      expect(git(["config", "user.name", "Rootform Test"], repository).exitCode).toBe(0);
      expect(git(["config", "user.email", "test@rootform.dev"], repository).exitCode).toBe(0);
      expect(
        git(["commit", "--quiet", "--allow-empty", "-m", "chore: initialize fixture"], repository)
          .exitCode,
      ).toBe(0);
      const base = git(["rev-parse", "HEAD"], repository).stdout.trim();
      expect(
        git(["commit", "--quiet", "--allow-empty", "-m", "fix(ci): parse subjects"], repository)
          .exitCode,
      ).toBe(0);
      const head = git(["rev-parse", "HEAD"], repository).stdout.trim();
      const result = Bun.spawnSync(["bun", join(root, "scripts/check-commit-range.ts")], {
        cwd: repository,
        env: { ...process.env, BASE_SHA: base, HEAD_SHA: head },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).toContain("Commit range passed.");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(repository, { force: true, recursive: true });
    }
  });
});
