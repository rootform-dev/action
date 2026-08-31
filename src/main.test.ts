import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffPaths } from "./diff.ts";
import { containedInput, containedOutput, type MainDependencies, main } from "./main.ts";
import { REPORT_MARKER } from "./report.ts";
import { RootformCommandError, resultPaths } from "./run.ts";

function fakeCore(
  options: { booleans?: Record<string, boolean>; inputs?: Record<string, string> } = {},
): {
  core: MainDependencies["core"];
  failures: string[];
  notices: string[];
  outputs: Map<string, string>;
  secrets: string[];
  summaries: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const notices: string[] = [];
  const outputs = new Map<string, string>();
  const secrets: string[] = [];
  const summaries: string[] = [];
  const warnings: string[] = [];
  return {
    core: {
      getBooleanInput: (name) => options.booleans?.[name] ?? false,
      getInput: (name) => options.inputs?.[name] ?? "",
      notice: (message) => notices.push(message),
      setFailed: (message) => failures.push(message),
      setOutput: (name, value) => outputs.set(name, value),
      setSecret: (value) => secrets.push(value),
      summary: {
        addRaw: (value) => ({
          write: async () => {
            summaries.push(value);
          },
        }),
      },
      warning: (message) => warnings.push(message),
    },
    failures,
    notices,
    outputs,
    secrets,
    summaries,
    warnings,
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

  test("uploads pull request evidence and updates one GitHub-native report", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-report-test-"));
    const baseline = join(workspace, "before");
    const current = join(workspace, "after");
    mkdirSync(baseline);
    mkdirSync(current);
    const state = fakeCore({
      booleans: {
        "fail-on-changes": false,
        "fail-on-violations": true,
        "report-diff": true,
        "upload-artifact": true,
      },
      inputs: {
        "artifact-name": "rootform-pr-17",
        "baseline-path": "before",
        "output-directory": "results",
        path: "after",
        "pull-request-token": "comment-token",
      },
    });
    const uploads: Array<{ files: string[]; name: string; root: string }> = [];
    const comments: Array<{ body: string; token: string }> = [];
    try {
      await main({
        artifactClient: () => ({
          uploadArtifact: async (name, files, root) => {
            uploads.push({ files, name, root });
            return { id: 17 };
          },
        }),
        comment: async ({ body, token }) => {
          comments.push({ body, token });
          return {
            action: "updated",
            htmlUrl: "https://github.com/rootform-dev/action/pull/17#issuecomment-29",
            id: 29,
          };
        },
        context: () => ({
          eventName: "pull_request",
          pullRequest: {
            apiUrl: "https://api.github.com",
            baseSha: "a".repeat(40),
            headSha: "b".repeat(40),
            number: 17,
            repository: "rootform-dev/action",
            sameRepository: true,
          },
          workflowUrl: "https://github.com/rootform-dev/action/actions/runs/71",
        }),
        core: state.core,
        diff: (options) => {
          expect(options.baselineWorkspace).toBe(baseline);
          expect(options.workspace).toBe(current);
          const paths = diffPaths(options.outputDirectory, true);
          if (!paths.baselineArchitecture || !paths.baselineHtml) {
            throw new Error("baseline paths missing");
          }
          writeFileSync(paths.baselineArchitecture, '{"baseline":true}');
          writeFileSync(paths.baselineHtml, "<!doctype html><title>Before</title>");
          writeFileSync(paths.json, '{"changed":true}');
          writeFileSync(paths.markdown, "## Rootform diff\n\n| Change | What |\n| --- | --- |\n");
          return { exitCode: 1, paths };
        },
        install: async () => ({
          binary: "/tool-cache/rootform",
          sha256: "a".repeat(64),
          version: "0.1.0-dev.2",
        }),
        run: (options) => {
          expect(options.input).toBe(".");
          expect(options.workspace).toBe(current);
          mkdirSync(options.outputDirectory);
          const paths = resultPaths(options.outputDirectory);
          for (const [path, contents] of [
            [paths.architecture, '{"current":true}'],
            [paths.html, "<!doctype html><title>After</title>"],
            [paths.markdown, "## Rootform check\n\nNo policy violations.\n"],
            [paths.policyJson, "{}"],
            [paths.sarif, "{}"],
          ] as const) {
            writeFileSync(path, contents);
          }
          return { exitCode: 0, paths };
        },
        workspace: () => workspace,
        workflowUrl: () => "https://github.com/rootform-dev/action/actions/runs/71",
      });

      expect(state.failures).toEqual([]);
      expect(state.secrets).toEqual(["comment-token"]);
      expect(state.warnings).toEqual(["Rootform detected architecture changes."]);
      expect(state.notices).toEqual([]);
      expect(comments).toHaveLength(1);
      expect(comments[0]?.token).toBe("comment-token");
      expect(comments[0]?.body).toStartWith(REPORT_MARKER);
      expect(comments[0]?.body).toContain("| Architecture | ⚠️ Changes detected |");
      expect(state.summaries).toHaveLength(1);
      expect(state.summaries[0]).toContain(
        "Updated — [open comment](https://github.com/rootform-dev/action/pull/17#issuecomment-29)",
      );
      expect(Object.fromEntries(state.outputs)).toEqual({
        architecture: "results/architecture.json",
        "artifact-id": "17",
        "artifact-url": "https://github.com/rootform-dev/action/actions/runs/71/artifacts/17",
        "baseline-architecture": "results/baseline-architecture.json",
        "baseline-html": "results/baseline-architecture.html",
        "diff-exit-code": "1",
        "diff-json": "results/architecture-diff.json",
        "diff-markdown": "results/architecture-diff.md",
        "exit-code": "0",
        html: "results/architecture.html",
        "policy-json": "results/policy.json",
        sarif: "results/policy.sarif",
        version: "0.1.0-dev.2",
      });
      expect(uploads).toEqual([
        {
          files: [
            join(workspace, "results", "architecture.json"),
            join(workspace, "results", "architecture.html"),
            join(workspace, "results", "policy.json"),
            join(workspace, "results", "policy.sarif"),
            join(workspace, "results", "baseline-architecture.json"),
            join(workspace, "results", "baseline-architecture.html"),
            join(workspace, "results", "architecture-diff.json"),
            join(workspace, "results", "architecture-diff.md"),
          ],
          name: "rootform-pr-17",
          root: join(workspace, "results"),
        },
      ]);
      expect([...state.outputs.values()].some((value) => value.includes(workspace))).toBeFalse();
      expect(
        JSON.stringify({
          comments: comments.map(({ body }) => body),
          summaries: state.summaries,
        }),
      ).not.toContain("comment-token");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("gates architecture changes independently and preserves diff failures", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-gate-test-"));
    mkdirSync(join(workspace, "before"));
    const state = fakeCore({
      booleans: { "fail-on-changes": true, "report-diff": true },
      inputs: { "baseline-path": "before", "output-directory": "results" },
    });
    try {
      await main({
        artifactClient: () => ({ uploadArtifact: async () => ({ id: 1 }) }),
        context: () => ({ eventName: "push" }),
        core: state.core,
        diff: (options) => {
          const paths = diffPaths(options.outputDirectory, true);
          writeFileSync(paths.markdown, "## Rootform diff\n");
          writeFileSync(paths.json, "{}");
          return { exitCode: 1, paths };
        },
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        run: (options) => {
          mkdirSync(options.outputDirectory);
          const paths = resultPaths(options.outputDirectory);
          for (const path of Object.values(paths)) writeFileSync(path, "# Rootform\n");
          return { exitCode: 0, paths };
        },
        workspace: () => workspace,
      });
      expect(state.outputs.get("diff-exit-code")).toBe("1");
      expect(state.failures).toEqual(["Rootform diff exited 1"]);
      expect(state.summaries[0]).toContain("Skipped — workflow event is not `pull_request`");
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

  test("accepts contained project roots and rejects unsafe source or plan paths", () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-input-test-"));
    const outside = mkdtempSync(join(tmpdir(), "rootform-input-outside-test-"));
    try {
      mkdirSync(join(workspace, "infra"));
      writeFileSync(join(workspace, "plan.json"), "{}");
      writeFileSync(join(workspace, "not-directory"), "");
      symlinkSync(outside, join(workspace, "linked"));
      expect(containedInput(workspace, "infra", "directory")).toBe(join(workspace, "infra"));
      expect(containedInput(workspace, "plan.json", "file")).toBe(join(workspace, "plan.json"));
      expect(() => containedInput(workspace, "../outside", "directory")).toThrow(
        "stay inside workspace",
      );
      expect(() => containedInput(workspace, join(workspace, "infra"), "directory")).toThrow(
        "workspace-relative",
      );
      expect(() => containedInput(workspace, "linked", "directory")).toThrow("symbolic link");
      expect(() => containedInput(workspace, "not-directory", "directory")).toThrow(
        "must be a directory",
      );
      expect(() => containedInput(workspace, "missing", "file")).toThrow("does not exist");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
