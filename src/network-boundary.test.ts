import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
