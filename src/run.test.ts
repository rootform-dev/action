import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandPlan, RootformCommandError, resultPaths, runAnalysis, shouldFail } from "./run.ts";

describe("Rootform command execution", () => {
  test("keeps source and plan grammar explicit", () => {
    const paths = resultPaths("results");
    expect(commandPlan("rootform", "source", "infra", paths).buildJson).toEqual([
      "rootform",
      "build",
      "infra",
      "--format",
      "json",
      "--output",
      paths.architecture,
    ]);
    expect(commandPlan("rootform", "plan", "plan.json", paths).checkSarif).toEqual([
      "rootform",
      "check",
      "--plan",
      "plan.json",
      "--format",
      "sarif",
      "--output",
      paths.sarif,
    ]);
  });

  test("preserves documented check exit codes", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-run-test-"));
    try {
      for (const exitCode of [0, 1, 2, 3]) {
        const result = runAnalysis({
          binary: "rootform",
          input: ".",
          mode: "source",
          outputDirectory: join(workspace, `result-${exitCode}`),
          runner: (command) => ({
            exitCode: command[1] === "check" ? exitCode : 0,
            stderr: "",
          }),
          workspace,
        });
        expect(result.exitCode).toBe(exitCode);
      }
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("runs source commands from exact project roots", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-run-root-test-"));
    const project = join(workspace, "infra");
    const workingDirectories: string[] = [];
    try {
      const result = runAnalysis({
        binary: "rootform",
        input: ".",
        mode: "source",
        outputDirectory: join(workspace, "results"),
        runner: (command, cwd) => {
          workingDirectories.push(cwd);
          expect(command[2]).toBe(".");
          return { exitCode: 0, stderr: "" };
        },
        workspace: project,
      });
      expect(result.exitCode).toBe(0);
      expect(workingDirectories).toHaveLength(5);
      expect(new Set(workingDirectories)).toEqual(new Set([project]));
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("rejects inconsistent formats and preserves build failure code", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-run-test-"));
    try {
      let checks = 0;
      expect(() =>
        runAnalysis({
          binary: "rootform",
          input: ".",
          mode: "source",
          outputDirectory: join(workspace, "mismatch"),
          runner: (command) => ({
            exitCode: command[1] === "check" ? checks++ % 2 : 0,
            stderr: "",
          }),
          workspace,
        }),
      ).toThrow("different exit codes");

      try {
        runAnalysis({
          binary: "rootform",
          input: ".",
          mode: "source",
          outputDirectory: join(workspace, "build-failure"),
          runner: () => ({ exitCode: 3, stderr: "indeterminate" }),
          workspace,
        });
        throw new Error("expected runAnalysis to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(RootformCommandError);
        expect((error as RootformCommandError).exitCode).toBe(3);
      }
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("fails violations only when configured and always fails invalid outcomes", () => {
    expect(shouldFail(0, true)).toBeFalse();
    expect(shouldFail(1, false)).toBeFalse();
    expect(shouldFail(1, true)).toBeTrue();
    expect(shouldFail(2, false)).toBeTrue();
    expect(shouldFail(3, false)).toBeTrue();
  });
});
