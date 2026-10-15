import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("pre-push keeps nested Git fixtures separate from the pushed repository", () => {
  const scratch = mkdtempSync(join(tmpdir(), "rootform-hook-environment-"));
  const parent = join(scratch, "parent");
  const child = join(scratch, "child");
  const bin = join(scratch, "bin");
  const git = (directory: string, args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: directory,
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  try {
    for (const directory of [parent, child]) {
      mkdirSync(directory);
      git(directory, ["init", "--quiet"]);
      git(directory, ["config", "user.name", "Rootform Test"]);
      git(directory, ["config", "user.email", "test@rootform.dev"]);
      git(directory, ["commit", "--quiet", "--allow-empty", "-m", "chore: initialize fixture"]);
    }
    mkdirSync(bin);
    const fakeBun = join(bin, "bun");
    writeFileSync(
      fakeBun,
      '#!/bin/sh\nset -eu\nif [ "$1" = "scripts/pre-push.ts" ]; then\n  git -C "$ROOTFORM_HOOK_CHILD" commit --quiet --allow-empty -m "chore: verify hook isolation"\nfi\n',
    );
    chmodSync(fakeBun, 0o755);
    const parentHead = git(parent, ["rev-parse", "HEAD"]);
    const result = Bun.spawnSync(["sh", join(import.meta.dir, "../.githooks/pre-push")], {
      cwd: parent,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GIT_DIR: join(parent, ".git"),
        GIT_COMMON_DIR: join(parent, ".git"),
        GIT_WORK_TREE: parent,
        GIT_INDEX_FILE: join(parent, ".git/index"),
        ROOTFORM_HOOK_CHILD: child,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(git(parent, ["rev-parse", "HEAD"])).toBe(parentHead);
    expect(git(child, ["log", "-1", "--format=%s"])).toBe("chore: verify hook isolation");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
