import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffPaths } from "./diff.ts";
import {
  containedInput,
  containedOutput,
  GENERATED_LOCK_NOTICE,
  LOCK_FILE,
  type MainDependencies,
  main,
} from "./main.ts";
import type { Preparation } from "./preparation.ts";
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
  variables: Map<string, string>;
  warnings: string[];
} {
  const failures: string[] = [];
  const notices: string[] = [];
  const outputs = new Map<string, string>();
  const secrets: string[] = [];
  const summaries: string[] = [];
  const variables = new Map<string, string>();
  const warnings: string[] = [];
  return {
    core: {
      exportVariable: (name, value) => variables.set(name, value),
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
    variables,
    warnings,
  };
}

function fakePreparation(overrides: Partial<Preparation> = {}): Preparation {
  return {
    dialects: [{ name: "aws", version: "0.1.0" }],
    lockWritten: false,
    providersDetected: 1,
    resolutionMode: "default",
    unsupportedProviders: [],
    warnings: [],
    ...overrides,
  };
}

function runnerTemporary(): string {
  return mkdtempSync(join(tmpdir(), "rootform-home-test-"));
}

describe("main Action entrypoint", () => {
  test("publishes only relative outputs, CLI summary, and allow-listed artifacts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const home = runnerTemporary();
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
      home: () => home,
      install: async () => ({
        binary: "/tool-cache/rootform",
        sha256: "a".repeat(64),
        version: "1.2.3",
      }),
      prepare: () => fakePreparation(),
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
        "lock-created": "false",
        "policy-json": "results/policy.json",
        "resolution-mode": "default",
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
      rmSync(home, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("preserves invalid CLI code and skips summaries and artifacts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const home = runnerTemporary();
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
        home: () => home,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        prepare: () => fakePreparation(),
        run: (options) => {
          mkdirSync(options.outputDirectory);
          return { exitCode: 3, paths: resultPaths(options.outputDirectory) };
        },
        workspace: () => workspace,
      });
      expect(state.outputs).toEqual(
        new Map([
          ["version", "1.2.3"],
          ["resolution-mode", "default"],
          ["lock-created", "false"],
          ["exit-code", "3"],
        ]),
      );
      expect(state.failures).toEqual(["Rootform check exited 3"]);
      expect(state.summaries).toEqual([]);
      expect(uploadCalled).toBeFalse();
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("redacts runner path while retaining exact command failure code", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-test-"));
    const home = runnerTemporary();
    const state = fakeCore();
    try {
      await main({
        artifactClient: () => ({ uploadArtifact: async () => ({ id: 1 }) }),
        core: state.core,
        home: () => home,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        prepare: () => fakePreparation(),
        run: () => {
          throw new RootformCommandError(3, `${workspace}/secret.tf failed`);
        },
        workspace: () => workspace,
      });
      expect(state.outputs.get("exit-code")).toBe("3");
      expect(state.failures).toEqual(["<runner-path>/secret.tf failed"]);
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("uploads pull request evidence and updates one GitHub-native report", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-report-test-"));
    const home = runnerTemporary();
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
        home: () => home,
        install: async () => ({
          binary: "/tool-cache/rootform",
          sha256: "a".repeat(64),
          version: "0.1.0-dev.2",
        }),
        prepare: () => fakePreparation(),
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
        "lock-created": "false",
        "policy-json": "results/policy.json",
        "resolution-mode": "default",
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
      rmSync(home, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("gates architecture changes independently and preserves diff failures", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-gate-test-"));
    const home = runnerTemporary();
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
        home: () => home,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" }),
        prepare: () => fakePreparation(),
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
      rmSync(home, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("isolates the Rootform home without publishing its path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-home-test-"));
    const runnerTemp = mkdtempSync(join(tmpdir(), "rootform-runner-temp-"));
    const originalRunnerTemp = process.env.RUNNER_TEMP;
    const originalHome = process.env.ROOTFORM_HOME;
    process.env.RUNNER_TEMP = runnerTemp;
    const state = fakeCore({
      booleans: { "upload-artifact": true },
      inputs: { "output-directory": "results" },
    });
    const uploads: Array<{ files: string[]; root: string }> = [];
    let observedHome: string | undefined;
    try {
      await main({
        artifactClient: () => ({
          uploadArtifact: async (_name, files, root) => {
            uploads.push({ files, root });
            return { id: 5 };
          },
        }),
        core: state.core,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "0.1.0" }),
        prepare: () => {
          observedHome = process.env.ROOTFORM_HOME;
          return fakePreparation();
        },
        run: (options) => {
          mkdirSync(options.outputDirectory);
          const paths = resultPaths(options.outputDirectory);
          for (const path of Object.values(paths)) writeFileSync(path, "# Rootform\n");
          return { exitCode: 0, paths };
        },
        workspace: () => workspace,
      });

      expect(state.failures).toEqual([]);
      const exported = state.variables.get("ROOTFORM_HOME");
      expect(exported).toBeString();
      const home = exported as string;
      // The home is created under the runner temporary directory so one job can
      // never observe another job's dialect store.
      expect(home).toStartWith(`${runnerTemp}/`);
      expect(existsSync(home)).toBeTrue();
      // Preparation observes the isolated home rather than the ambient one.
      expect(observedHome).toBe(home);

      // Constitution VII: the absolute runner path is exported for later steps
      // and published nowhere.
      for (const value of state.outputs.values()) expect(value).not.toContain(runnerTemp);
      expect(state.summaries.join("\n")).not.toContain(runnerTemp);
      expect(state.warnings.join("\n")).not.toContain(runnerTemp);
      expect(state.notices.join("\n")).not.toContain(runnerTemp);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]?.root).toBe(join(workspace, "results"));
      for (const file of uploads[0]?.files ?? []) expect(file).not.toContain(runnerTemp);
    } finally {
      if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
      else process.env.RUNNER_TEMP = originalRunnerTemp;
      if (originalHome === undefined) delete process.env.ROOTFORM_HOME;
      else process.env.ROOTFORM_HOME = originalHome;
      rmSync(runnerTemp, { force: true, recursive: true });
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("surfaces a generated lock without committing it", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rootform-main-lock-test-"));
    const home = runnerTemporary();
    const project = join(workspace, "infra");
    mkdirSync(project);
    writeFileSync(join(project, "main.tf"), 'provider "aws" {}\n');
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: workspace, encoding: "utf8", stdio: "pipe" });
    git("init", "--quiet", "--initial-branch", "work");
    git("add", "--all");
    git(
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "-m",
      "seed",
    );

    const state = fakeCore({
      booleans: { "upload-artifact": true },
      inputs: { "artifact-name": "rootform", "output-directory": "results", path: "infra" },
    });
    const uploads: Array<{ files: string[]; root: string }> = [];
    try {
      await main({
        artifactClient: () => ({
          uploadArtifact: async (_name, files, root) => {
            uploads.push({ files, root });
            return { id: 9 };
          },
        }),
        context: () => ({ eventName: "push" }),
        core: state.core,
        home: () => home,
        install: async () => ({ binary: "rootform", sha256: "a".repeat(64), version: "0.1.0" }),
        prepare: (options) => {
          // The CLI owns lock creation; the Action only observes the result.
          writeFileSync(join(options.workspace, LOCK_FILE), '{"format_version":"1"}\n');
          return fakePreparation({ lockWritten: true });
        },
        run: (options) => {
          mkdirSync(options.outputDirectory);
          const paths = resultPaths(options.outputDirectory);
          for (const path of Object.values(paths)) writeFileSync(path, "# Rootform\n");
          return { exitCode: 0, paths };
        },
        workspace: () => workspace,
      });

      expect(state.failures).toEqual([]);
      expect(state.outputs.get("lock-created")).toBe("true");
      expect(state.outputs.get("lock-path")).toBe("infra/rootform.lock");
      expect(state.warnings).toContain(GENERATED_LOCK_NOTICE);

      // The generated lock travels as artifact evidence, copied into the result
      // directory rather than uploaded from the project tree.
      const lockEvidence = join(workspace, "results", LOCK_FILE);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]?.files).toContain(lockEvidence);
      expect(readFileSync(lockEvidence, "utf8")).toBe('{"format_version":"1"}\n');

      // The repository keeps the lock untracked: nothing stages, commits, or
      // pushes it on the caller's behalf.
      const status = git("status", "--porcelain").stdout;
      expect(status).toContain("?? infra/rootform.lock");
      expect(status).not.toContain("A  infra/rootform.lock");
      expect(git("log", "--oneline").stdout.trim().split("\n")).toHaveLength(1);
    } finally {
      rmSync(home, { force: true, recursive: true });
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
