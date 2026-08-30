import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedOutput, type MainDependencies, main } from "./main.ts";
import { RootformCommandError, resultPaths } from "./run.ts";

function fakeCore(
  options: { booleans?: Record<string, boolean>; inputs?: Record<string, string> } = {},
): {
  core: MainDependencies["core"];
  failures: string[];
  outputs: Map<string, string>;
  summaries: string[];
} {
  const failures: string[] = [];
  const outputs = new Map<string, string>();
  const summaries: string[] = [];
  return {
    core: {
      getBooleanInput: (name) => options.booleans?.[name] ?? false,
      getInput: (name) => options.inputs?.[name] ?? "",
      setFailed: (message) => failures.push(message),
      setOutput: (name, value) => outputs.set(name, value),
      summary: {
        addRaw: (value) => ({
          write: async () => {
            summaries.push(value);
          },
        }),
      },
    },
    failures,
    outputs,
    summaries,
  };
}

describe("main Action entrypoint", () => {
  test("publishes only relative outputs, CLI summary, and allow-listed artifacts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const state = fakeCore({
      booleans: { "fail-on-violations": false, "upload-artifact": true },
      inputs: { "artifact-name": "rootform-test", "output-directory": "results" },
    });
    const uploads: Array<{ files: string[]; name: string; root: string }> = [];
    const dependencies: MainDependencies = {
      artifactClient: () => ({
        uploadArtifact: async (name, files, root) => {
          uploads.push({ files, name, root });
          return { artifactUrl: "https://example.invalid/artifact/17", id: 17 };
        },
      }),
      core: state.core,
      install: async () => ({
        binary: "/tool-cache/rootform",
        sha256: "a".repeat(64),
        version: "1.2.3",
      }),
      run: (options) => {
        mkdirSync(options.outputDirectory);
        const paths = resultPaths(options.outputDirectory);
        for (const [path, contents] of [
          [paths.architecture, "{}"],
          [paths.html, "<!doctype html>"],
          [paths.markdown, "# Rootform\n"],
          [paths.policyJson, "{}"],
          [paths.sarif, "{}"],
        ] as const) {
          writeFileSync(path, contents);
        }
        return { exitCode: 0, paths };
      },
      workspace: () => workspace,
    };

    try {
      await main(dependencies);
      expect(state.failures).toEqual([]);
      expect(state.summaries).toEqual(["# Rootform\n"]);
      expect(Object.fromEntries(state.outputs)).toEqual({
        architecture: "results/architecture.json",
        "artifact-id": "17",
        "artifact-url": "https://example.invalid/artifact/17",
        "exit-code": "0",
        html: "results/architecture.html",
        "policy-json": "results/policy.json",
        sarif: "results/policy.sarif",
        version: "1.2.3",
      });
      expect(uploads).toEqual([
        {
          files: [
            join(workspace, "results", "architecture.json"),
            join(workspace, "results", "architecture.html"),
            join(workspace, "results", "policy.json"),
            join(workspace, "results", "policy.sarif"),
          ],
          name: "rootform-test",
          root: join(workspace, "results"),
        },
      ]);
      expect([...state.outputs.values()].some((value) => value.includes(workspace))).toBeFalse();
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("preserves invalid CLI code and skips summaries and artifacts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const state = fakeCore({ booleans: { "upload-artifact": true } });
    let uploadCalled = false;
    try {
      await main({
        artifactClient: () => ({
          uploadArtifact: async () => {
            uploadCalled = true;
            return { id: 1 };
          },
        }),
        core: state.core,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        run: (options) => {
          mkdirSync(options.outputDirectory);
          return { exitCode: 3, paths: resultPaths(options.outputDirectory) };
        },
        workspace: () => workspace,
      });
      expect(state.outputs).toEqual(
        new Map([
          ["version", "1.2.3"],
          ["exit-code", "3"],
        ]),
      );
      expect(state.failures).toEqual(["Rootform check exited 3"]);
      expect(state.summaries).toEqual([]);
      expect(uploadCalled).toBeFalse();
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("redacts runner path while retaining exact command failure code", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const state = fakeCore();
    try {
      await main({
        artifactClient: () => ({ uploadArtifact: async () => ({ id: 1 }) }),
        core: state.core,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        run: () => {
          throw new RootformCommandError(3, `${workspace}/secret.tf failed`);
        },
        workspace: () => workspace,
      });
      expect(state.outputs.get("exit-code")).toBe("3");
      expect(state.failures).toEqual(["<runner-path>/secret.tf failed"]);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("rejects output traversal, absolute paths, existing paths, and symlink ancestors", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-output-test-"));
    const outside = mkdtempSync(join(tmpdir(), "rootform-outside-test-"));
    try {
      mkdirSync(join(workspace, "existing"));
      symlinkSync(outside, join(workspace, "linked"));
      expect(() => containedOutput(workspace, "../outside")).toThrow("stay inside workspace");
      expect(() => containedOutput(workspace, join(workspace, "absolute"))).toThrow(
        "workspace-relative",
      );
      expect(() => containedOutput(workspace, "existing")).toThrow("already exists");
      expect(() => containedOutput(workspace, "linked/results")).toThrow("symbolic link");
      expect(containedOutput(workspace, "nested/results")).toBe(
        join(workspace, "nested", "results"),
      );
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
