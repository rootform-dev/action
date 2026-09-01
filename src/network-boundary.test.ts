import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliEnvironment } from "./environment.ts";
import { type MainDependencies, main } from "./main.ts";
import { resultPaths } from "./run.ts";

test("main performs no network operation after injected installation", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-network-test-"));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      networkCalls++;
      throw new Error("unexpected network request");
    },
  });
  let installed = false;
  const dependencies: MainDependencies = {
    artifactClient: () => ({
      uploadArtifact: async () => {
        throw new Error("artifact upload must be disabled");
      },
    }),
    core: {
      getBooleanInput: () => false,
      getInput: () => "",
      setFailed: () => {},
      setOutput: () => {},
      summary: { addRaw: () => ({ write: async () => {} }) },
    },
    install: async () => {
      installed = true;
      return { binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" };
    },
    run: (options) => {
      expect(installed).toBeTrue();
      return { exitCode: 3, paths: resultPaths(options.outputDirectory) };
    },
    workspace: () => workspace,
  };

  try {
    await main(dependencies);
    expect(networkCalls).toBe(0);
  } finally {
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("isolates tokens from CLI children and failure evidence", async () => {
  const releaseToken = "release-secret-value";
  const pullRequestToken = "pull-request-secret-value";
  expect(
    cliEnvironment({
      GITHUB_TOKEN: "implicit-secret",
      GITHUB_WORKSPACE: "/workspace",
      "INPUT_GITHUB-TOKEN": releaseToken,
      "INPUT_PULL-REQUEST-TOKEN": pullRequestToken,
    }),
  ).toEqual({ GITHUB_WORKSPACE: "/workspace" });

  const workspace = mkdtempSync(join(tmpdir(), "rootform-token-test-"));
  const failures: string[] = [];
  const secrets: string[] = [];
  try {
    await main({
      artifactClient: () => ({ uploadArtifact: async () => ({ id: 1 }) }),
      core: {
        getBooleanInput: () => false,
        getInput: (name) => {
          if (name === "github-token") return releaseToken;
          if (name === "pull-request-token") return pullRequestToken;
          return "";
        },
        setFailed: (message) => failures.push(message),
        setOutput: () => {},
        setSecret: (value) => secrets.push(value),
        summary: { addRaw: () => ({ write: async () => {} }) },
      },
      install: async () => {
        throw new Error(`${releaseToken}/${pullRequestToken}/${workspace}/private`);
      },
      run: () => {
        throw new Error("run must not be reached");
      },
      workspace: () => workspace,
    });
    expect(secrets).toEqual([releaseToken, pullRequestToken]);
    expect(failures).toEqual(["***/***/<runner-path>/private"]);
    expect(failures.join("\n")).not.toContain(releaseToken);
    expect(failures.join("\n")).not.toContain(pullRequestToken);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
