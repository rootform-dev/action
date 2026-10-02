import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MainDependencies, main } from "./main.ts";

const entrypoints = [
  {
    kind: "main",
    manifest: "../action.yml",
    bundle: "dist/main/index.js",
    source: "main-entry.ts",
  },
  {
    kind: "setup",
    manifest: "../setup/action.yml",
    bundle: "../dist/setup/index.js",
    source: "setup-entry.ts",
  },
  {
    kind: "init",
    manifest: "../init/action.yml",
    bundle: "../dist/init/index.js",
    source: "init-entry.ts",
  },
  {
    kind: "analyze",
    manifest: "../analyze/action.yml",
    bundle: "../dist/analyze/index.js",
    source: "analyze-entry.ts",
  },
  {
    kind: "compare",
    manifest: "../compare/action.yml",
    bundle: "../dist/compare/index.js",
    source: "compare-entry.ts",
  },
  {
    kind: "check",
    manifest: "../check/action.yml",
    bundle: "../dist/check/index.js",
    source: "check-entry.ts",
  },
] as const;

const retiredInputs = [
  "mode",
  "path",
  "output-directory",
  "fail-on-violations",
  "report-diff",
  "baseline-path",
  "fail-on-changes",
  "pull-request-token",
];

function manifestSection(contents: string, name: "inputs" | "outputs"): string {
  const header = new RegExp(`^${name}:\\s*$`, "mu").exec(contents);
  if (!header || header.index === undefined) return "";

  const start = header.index + header[0].length;
  const remainder = contents.slice(start);
  const nextSection = /^[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(remainder);
  return remainder.slice(0, nextSection?.index ?? remainder.length);
}

function manifestKeys(contents: string, name: "inputs" | "outputs"): string[] {
  return [...manifestSection(contents, name).matchAll(/^ {2}([A-Za-z][A-Za-z0-9-]*):\s*$/gmu)].map(
    (match) => match[1] || "",
  );
}

function trackedDependencies(workspace: string, temporary: string, inputs: Record<string, string>) {
  const commands: Array<{ command: string[]; cwd: string }> = [];
  const failures: string[] = [];
  const outputs = new Map<string, string>();
  const environment: NodeJS.ProcessEnv = {
    GITHUB_WORKSPACE: workspace,
    RUNNER_TEMP: temporary,
  };
  let installCalls = 0;
  let analysisCalls = 0;

  const dependencies: MainDependencies = {
    core: {
      getInput: (name) => inputs[name] ?? "",
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(String(message)),
      exportVariable: (name, value) => {
        environment[name] = value;
      },
      setSecret: () => {},
      warning: () => {},
      summary: { addRaw: () => ({ write: async () => {} }) },
    },
    install: async () => {
      installCalls++;
      return { binary: "rootform", sha256: "a".repeat(64), version: "1.2.3" };
    },
    environment,
    context: () => ({ eventName: "push" }),
    runner: (command, cwd) => {
      commands.push({ command, cwd });
      return { exitCode: 0, stderr: "" };
    },
    run: () => {
      analysisCalls++;
      return { paths: {}, reports: [] };
    },
    comment: async () => {
      throw new Error("commenting must remain disabled in this fixture");
    },
    artifactClient: () => ({ uploadArtifact: async () => ({}) }),
    cacheClient: () => ({ restore: async () => undefined, save: async () => {} }),
  };

  return {
    dependencies,
    commands,
    failures,
    outputs,
    get installCalls() {
      return installCalls;
    },
    get analysisCalls() {
      return analysisCalls;
    },
  };
}

test("six manifests use thin adapters and one shared installer without retired contracts", async () => {
  const sourceDirectory = import.meta.dir;
  const mainSource = await Bun.file(join(sourceDirectory, "main.ts")).text();
  expect(mainSource).toContain('import { type Installation, installRootform } from "./install.ts"');
  expect(mainSource).toContain("install: installRootform");

  const installerDefinitions: string[] = [];
  for (const source of new Bun.Glob("*.ts").scanSync(sourceDirectory)) {
    if (source.endsWith(".test.ts")) continue;
    const contents = await Bun.file(join(sourceDirectory, source)).text();
    if (contents.includes("export async function installRootform"))
      installerDefinitions.push(source);
  }
  expect(installerDefinitions).toEqual(["install.ts"]);

  for (const entry of entrypoints) {
    const manifest = await Bun.file(join(sourceDirectory, entry.manifest)).text();
    const inputSection = manifestSection(manifest, "inputs");
    const inputKeys = manifestKeys(manifest, "inputs");
    const outputKeys = manifestKeys(manifest, "outputs");

    expect(manifest).toContain("using: node24");
    expect(manifest).toContain(`main: ${entry.bundle}`);
    expect(inputSection).not.toMatch(/^ {4}required:\s*true\s*$/mu);
    for (const name of retiredInputs) expect(inputKeys).not.toContain(name);
    for (const name of [
      "before",
      "after",
      "before-form",
      "after-form",
      "form-before",
      "form-after",
    ]) {
      expect(outputKeys).not.toContain(name);
    }

    const adapter = await Bun.file(join(sourceDirectory, entry.source)).text();
    expect(adapter.trim()).toBe(
      `import { runEntry } from "./main.ts";\n\nawait runEntry("${entry.kind}");`,
    );
  }

  const setupManifest = await Bun.file(join(sourceDirectory, "../setup/action.yml")).text();
  expect(manifestKeys(setupManifest, "inputs")).not.toContain("project");

  const initManifest = await Bun.file(join(sourceDirectory, "../init/action.yml")).text();
  expect(manifestKeys(initManifest, "inputs")).not.toContain("input");
  for (const output of ["form", "report", "html", "result", "sarif"]) {
    expect(manifestKeys(initManifest, "outputs")).not.toContain(output);
  }
});

test("a business entrypoint installs and prepares raw input without preceding actions", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-entry-workspace-"));
  const temporary = mkdtempSync(join(tmpdir(), "rootform-entry-temp-"));
  const input = join(workspace, "plan.json");
  writeFileSync(input, "synthetic raw input");

  try {
    const tracked = trackedDependencies(workspace, temporary, {
      version: "1.2.3",
      input,
      cache: "false",
      summary: "false",
      "upload-artifact": "false",
    });

    await main("analyze", tracked.dependencies);

    expect(tracked.installCalls).toBe(1);
    expect(tracked.commands).toHaveLength(1);
    expect(tracked.commands[0]?.command[1]).toBe("init");
    expect(tracked.analysisCalls).toBe(1);
    expect(tracked.failures).toEqual([]);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("init prepares but never invokes the analysis runner", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-init-workspace-"));
  const temporary = mkdtempSync(join(tmpdir(), "rootform-init-temp-"));

  try {
    const tracked = trackedDependencies(workspace, temporary, {
      version: "1.2.3",
      cache: "false",
    });

    await main("init", tracked.dependencies);

    expect(tracked.installCalls).toBe(1);
    expect(tracked.commands).toHaveLength(1);
    expect(tracked.commands[0]?.command[1]).toBe("init");
    expect(tracked.analysisCalls).toBe(0);
    expect(tracked.failures).toEqual([]);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
    rmSync(temporary, { force: true, recursive: true });
  }
});
