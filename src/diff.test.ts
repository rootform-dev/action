import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffCommandPlan, diffPaths, runDiff } from "./diff.ts";
import { RootformCommandError } from "./run.ts";

describe("Rootform diff execution", () => {
  test("builds exact CLI diff plans", () => {
    const sourcePaths = diffPaths("results", true);
    if (!sourcePaths.baselineArchitecture || !sourcePaths.baselineHtml) {
      throw new Error("source paths omitted baseline files");
    }
    const source = diffCommandPlan({
      baselineWorkspace: "/workspace/base",
      binary: "rootform",
      currentArchitecture: "/workspace/results/architecture.json",
      input: ".",
      mode: "source",
      outputDirectory: "results",
      workspace: "/workspace",
    });
    expect(source.baseline).toEqual([
      {
        command: [
          "rootform",
          "build",
          ".",
          "--format",
          "json",
          "--output",
          sourcePaths.baselineArchitecture,
        ],
        cwd: "/workspace/base",
      },
      {
        command: [
          "rootform",
          "build",
          ".",
          "--format",
          "html",
          "--output",
          sourcePaths.baselineHtml,
        ],
        cwd: "/workspace/base",
      },
    ]);
    expect(source.comparisons[0]).toEqual({
      command: [
        "rootform",
        "diff",
        sourcePaths.baselineArchitecture,
        "/workspace/results/architecture.json",
        "--format",
        "json",
        "--output",
        sourcePaths.json,
        "--exit-code",
      ],
      cwd: "/workspace",
    });

    const planPaths = diffPaths("results", false);
    const plan = diffCommandPlan({
      binary: "rootform",
      currentArchitecture: "/workspace/results/architecture.json",
      input: "tfplan.json",
      mode: "plan",
      outputDirectory: "results",
      workspace: "/workspace",
    });
    expect(plan.baseline).toEqual([]);
    expect(plan.comparisons[1]).toEqual({
      command: [
        "rootform",
        "diff",
        "--plan",
        "tfplan.json",
        "--format",
        "markdown",
        "--output",
        planPaths.markdown,
        "--exit-code",
      ],
      cwd: "/workspace",
    });
  });

  test("preserves documented diff exit codes", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-diff-test-"));
    try {
      for (const exitCode of [0, 1]) {
        const result = runDiff({
          binary: "rootform",
          currentArchitecture: join(workspace, "architecture.json"),
          input: "tfplan.json",
          mode: "plan",
          outputDirectory: workspace,
          runner: () => ({ exitCode, stderr: "" }),
          workspace,
        });
        expect(result.exitCode).toBe(exitCode);
      }
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("rejects inconsistent or invalid diff exits", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-diff-test-"));
    try {
      let comparisons = 0;
      expect(() =>
        runDiff({
          binary: "rootform",
          currentArchitecture: join(workspace, "architecture.json"),
          input: "tfplan.json",
          mode: "plan",
          outputDirectory: workspace,
          runner: () => ({ exitCode: comparisons++ % 2, stderr: "" }),
          workspace,
        }),
      ).toThrow("different exit codes");

      for (const exitCode of [2, 3, 9]) {
        try {
          runDiff({
            binary: "rootform",
            currentArchitecture: join(workspace, "architecture.json"),
            input: "tfplan.json",
            mode: "plan",
            outputDirectory: workspace,
            runner: () => ({ exitCode, stderr: "diff failed" }),
            workspace,
          });
          throw new Error("expected runDiff to fail");
        } catch (error) {
          expect(error).toBeInstanceOf(RootformCommandError);
          expect((error as RootformCommandError).exitCode).toBe(exitCode);
        }
      }
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
