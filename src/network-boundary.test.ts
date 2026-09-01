import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliEnvironment } from "./environment.ts";
import { type MainDependencies, main } from "./main.ts";
import { runPreparation } from "./preparation.ts";
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

test("keeps credentials out of preparation", () => {
  expect(
    cliEnvironment({
      GITHUB_TOKEN: "implicit-secret",
      GITHUB_WORKSPACE: "/workspace",
      "INPUT_GITHUB-TOKEN": "release-secret",
      "INPUT_PULL-REQUEST-TOKEN": "comment-secret",
      ROOTFORM_HOME: "/runner/temp/rootform-home",
    }),
  ).toEqual({ GITHUB_WORKSPACE: "/workspace", ROOTFORM_HOME: "/runner/temp/rootform-home" });

  /* The stripped environment is proven against a real child process, not only
     against the helper: preparation must reach the CLI with no credential even
     though it is the one command allowed to acquire dialects. */
  const workspace = mkdtempSync(join(tmpdir(), "rootform-preparation-env-"));
  const releaseToken = "release-secret-value";
  const pullRequestToken = "pull-request-secret-value";
  const implicitToken = "implicit-secret-value";
  const captured = join(workspace, "child-environment");
  const binary = join(workspace, "rootform");
  writeFileSync(
    binary,
    [
      "#!/bin/sh",
      `env > "${captured}"`,
      'printf \'{"format_version":"1","dialects":[],"lock_written":false,',
      '"providers_detected":0,"unsupported_providers":[],"warnings":[]}\\n\'',
      "",
    ].join("\n"),
  );
  chmodSync(binary, 0o755);

  const previous = {
    github: process.env.GITHUB_TOKEN,
    release: process.env["INPUT_GITHUB-TOKEN"],
    review: process.env["INPUT_PULL-REQUEST-TOKEN"],
  };
  process.env.GITHUB_TOKEN = implicitToken;
  process.env["INPUT_GITHUB-TOKEN"] = releaseToken;
  process.env["INPUT_PULL-REQUEST-TOKEN"] = pullRequestToken;
  try {
    const preparation = runPreparation({
      binary,
      input: ".",
      locked: false,
      offline: false,
      workspace,
    });
    expect(preparation.providersDetected).toBe(0);

    const contents = readFileSync(captured, "utf8");
    expect(contents.length).toBeGreaterThan(0);
    for (const secret of [implicitToken, releaseToken, pullRequestToken]) {
      expect(contents).not.toContain(secret);
    }
    for (const name of ["GITHUB_TOKEN=", "INPUT_GITHUB-TOKEN=", "INPUT_PULL-REQUEST-TOKEN="]) {
      expect(contents).not.toContain(name);
    }
  } finally {
    for (const [name, value] of [
      ["GITHUB_TOKEN", previous.github],
      ["INPUT_GITHUB-TOKEN", previous.release],
      ["INPUT_PULL-REQUEST-TOKEN", previous.review],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(workspace, { force: true, recursive: true });
  }
});
