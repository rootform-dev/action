import { expect, test } from "bun:test";
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
  let calls = 0;
  const dependencies: SetupDependencies = {
    core: {
      getInput: (name) => (name === "version" ? "1.2.3" : ""),
      setOutput: (name, value) => outputs.set(name, value),
    },
    install: async (options) => {
      calls++;
      expect(options).toEqual({ token: "", version: "1.2.3" });
      return { binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" };
    },
  };
  await setup(dependencies);
  expect(calls).toBe(1);
  expect(Object.fromEntries(outputs)).toEqual({ sha256: "a".repeat(64), version: "1.2.3" });
});
