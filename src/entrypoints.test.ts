import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SetupDependencies, setup } from "./setup.ts";

test("setup and main entrypoints import the one verified installer", async () => {
  const sourceDirectory = import.meta.dir;
  const setupSource = await Bun.file(`${sourceDirectory}/setup.ts`).text();
  const mainSource = await Bun.file(`${sourceDirectory}/main.ts`).text();
  expect(setupSource).toContain('from "./install.ts"');
  expect(mainSource).toContain('from "./install.ts"');

  const definitions: string[] = [];
  for (const relativePath of new Bun.Glob("*.ts").scanSync(sourceDirectory)) {
    if (relativePath.endsWith(".test.ts")) continue;
    const contents = await Bun.file(`${sourceDirectory}/${relativePath}`).text();
    if (contents.includes("export async function installRootform")) definitions.push(relativePath);
  }
  expect(definitions).toEqual(["install.ts"]);

  const outputs = new Map<string, string>();
  const secrets: string[] = [];
  let calls = 0;
  const dependencies: SetupDependencies = {
    core: {
      getInput: (name) => (name === "version" ? "1.2.3" : ""),
      setOutput: (name, value) => outputs.set(name, value),
      setSecret: (value) => secrets.push(value),
    },
    install: async (options) => {
      calls++;
      expect(options).toEqual({ token: "", version: "1.2.3" });
      return { binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" };
    },
  };
  await setup(dependencies);
  expect(calls).toBe(1);
  expect(secrets).toEqual([]);
  expect(Object.fromEntries(outputs)).toEqual({ sha256: "a".repeat(64), version: "1.2.3" });
});

test("setup never prepares dialects", async () => {
  const sourceDirectory = import.meta.dir;
  const setupSource = await Bun.file(`${sourceDirectory}/setup.ts`).text();

  /* Setup installs and verifies a CLI. Resolution, acquisition, locking, and
     caching belong to the analysis entrypoint, so setup must not even be able
     to reach them. */
  for (const module of ["./preparation.ts", "./cache.ts", "./run.ts", "./diff.ts"]) {
    expect(setupSource).not.toContain(module);
  }
  for (const symbol of [
    "runPreparation",
    "restoreDialectCache",
    "saveDialectCache",
    "ROOTFORM_HOME",
  ]) {
    expect(setupSource).not.toContain(symbol);
  }

  const bundle = join(sourceDirectory, "..", "dist", "setup", "index.js");
  if (existsSync(bundle)) {
    const bundled = await Bun.file(bundle).text();
    /* Markers unique to preparation and caching. Generic tokens are avoided
       because bundled dependencies legitimately contain them. */
    for (const marker of [
      "rootform-dialects-v1",
      "ROOTFORM_HOME",
      "Rootform initialization returned no machine envelope",
      "Rootform generated rootform.lock for this run",
    ]) {
      expect(bundled).not.toContain(marker);
    }
  }

  const workspace = `${sourceDirectory}/..`;
  const outputs = new Map<string, string>();
  let installArguments: { token: string; version: string } | undefined;
  await setup({
    core: {
      getInput: (name) => (name === "version" ? "0.1.0" : ""),
      setOutput: (name, value) => outputs.set(name, value),
    },
    install: async (options) => {
      installArguments = options;
      // A dialect store would exist only if setup prepared one.
      expect(existsSync(join(workspace, ".rootform"))).toBeFalse();
      return { binary: "rootform", sha256: "b".repeat(64), version: "0.1.0" };
    },
  });
  expect(installArguments).toEqual({ token: "", version: "0.1.0" });
  // Setup publishes installation identity only: no resolution mode, no lock.
  expect([...outputs.keys()].sort()).toEqual(["sha256", "version"]);
});
