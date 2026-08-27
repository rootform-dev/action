import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./lib/git.ts";

const repository = join(import.meta.dir, "..");

function executable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe("bundle gate commands", () => {
  test("rebuilds the committed bundle and refuses a stale one", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "rootform-action-verify-"));
    try {
      const bin = join(scratch, "bin");
      const log = join(scratch, "bun.log");
      mkdirSync(bin, { recursive: true });
      executable(
        join(bin, "bun"),
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$ROOTFORM_BUN_LOG"\nexit 0\n',
      );
      executable(
        join(bin, "gitleaks"),
        '#!/bin/sh\nif [ "$1" = "version" ]; then printf \'8.30.1\\n\'; fi\nexit 0\n',
      );
      executable(
        join(bin, "actionlint"),
        '#!/bin/sh\nif [ "$1" = "-version" ]; then printf \'1.7.12\\n\'; fi\nexit 0\n',
      );
      mkdirSync(join(scratch, "src"), { recursive: true });
      writeFileSync(join(scratch, "src", "action.ts"), "export {};\n");
      writeFileSync(join(scratch, "package.json"), JSON.stringify({ scripts: { build: "true" } }));
      expect(git(["init", "--quiet"], scratch).exitCode).toBe(0);
      expect(git(["config", "user.name", "Rootform Test"], scratch).exitCode).toBe(0);
      expect(git(["config", "user.email", "test@rootform.dev"], scratch).exitCode).toBe(0);
      expect(
        git(["commit", "--quiet", "--allow-empty", "-m", "chore: initialize fixture"], scratch)
          .exitCode,
      ).toBe(0);
      writeFileSync(join(scratch, ".gitignore"), "*\n");

      const result = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "verify.ts"), "--full"],
        {
          cwd: scratch,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            ROOTFORM_BASE_SHA: "",
            ROOTFORM_BUN_LOG: log,
            ROOTFORM_HEAD_BRANCH: "",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toBe("");
      expect(result.stdout.toString()).toContain("Full verification passed.");
      expect(await Bun.file(log).text()).toBe(["run check", "run build", ""].join("\n"));
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  });

  test("fails when the rebuilt bundle differs from the committed one", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "rootform-action-stale-"));
    try {
      const bin = join(scratch, "bin");
      mkdirSync(bin, { recursive: true });
      executable(
        join(bin, "bun"),
        '#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "build" ]; then printf \'changed\\n\' > "$ROOTFORM_BUNDLE"; fi\nexit 0\n',
      );
      executable(
        join(bin, "gitleaks"),
        '#!/bin/sh\nif [ "$1" = "version" ]; then printf \'8.30.1\\n\'; fi\nexit 0\n',
      );
      executable(
        join(bin, "actionlint"),
        '#!/bin/sh\nif [ "$1" = "-version" ]; then printf \'1.7.12\\n\'; fi\nexit 0\n',
      );
      mkdirSync(join(scratch, "src"), { recursive: true });
      mkdirSync(join(scratch, "dist"), { recursive: true });
      writeFileSync(join(scratch, "src", "action.ts"), "export {};\n");
      writeFileSync(join(scratch, "dist", "index.js"), "committed\n");
      writeFileSync(join(scratch, "package.json"), JSON.stringify({ scripts: { build: "true" } }));
      expect(git(["init", "--quiet"], scratch).exitCode).toBe(0);
      expect(git(["config", "user.name", "Rootform Test"], scratch).exitCode).toBe(0);
      expect(git(["config", "user.email", "test@rootform.dev"], scratch).exitCode).toBe(0);
      expect(git(["add", "dist/index.js"], scratch).exitCode).toBe(0);
      expect(git(["commit", "--quiet", "-m", "chore: commit bundle"], scratch).exitCode).toBe(0);
      writeFileSync(join(scratch, ".gitignore"), "*\n");

      const result = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "verify.ts"), "--full"],
        {
          cwd: scratch,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            ROOTFORM_BASE_SHA: "",
            ROOTFORM_BUNDLE: join(scratch, "dist", "index.js"),
            ROOTFORM_HEAD_BRANCH: "",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("committed bundle is stale");
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  });
});

describe("CI product spec metadata", () => {
  test("is supplied only while pull request branch identity still exists", async () => {
    const workflow = await Bun.file(join(repository, ".github/workflows/ci.yml")).text();
    expect(workflow).toContain(
      "github.event_name == 'pull_request' && github.event.pull_request.base.sha || ''",
    );
    expect(workflow).toContain("github.event_name == 'pull_request' && github.head_ref || ''");
    expect(workflow).not.toContain("github.head_ref || github.ref_name");
  });
});
