import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  expectedRootScripts,
  validateActionManifests,
  validateRootManifest,
} from "./validate-foundation.ts";

const repository = join(import.meta.dir, "..");
const sandboxes: string[] = [];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "rootform-action-foundation-"));
  sandboxes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function rootManifest(): Record<string, unknown> {
  return {
    name: "@rootform/action",
    version: "0.1.0",
    private: true,
    type: "module",
    packageManager: `bun@${Bun.version}`,
    engines: { bun: Bun.version },
    scripts: { ...expectedRootScripts },
    devDependencies: { "@biomejs/biome": "2.5.8" },
  };
}

function validSandbox(): string {
  const dir = sandbox();
  writeJson(join(dir, "package.json"), rootManifest());
  writeText(join(dir, "bun.lock"), '{\n  "lockfileVersion": 1\n}\n');
  return dir;
}

function actionSandbox(): string {
  const dir = validSandbox();
  writeText(join(dir, "dist", "index.js"), "export {};\n");
  writeText(join(dir, "dist", "setup.js"), "export {};\n");
  writeText(
    join(dir, "action.yml"),
    "name: Rootform\ndescription: Analyze Terraform\nruns:\n  using: node24\n  main: dist/index.js\n",
  );
  writeText(
    join(dir, "setup", "action.yml"),
    "name: Rootform setup\ndescription: Install the CLI\nruns:\n  using: node24\n  main: ../dist/setup.js\n",
  );
  return dir;
}

describe("foundation validation", () => {
  test("passes for the current repository", () => {
    const result = Bun.spawnSync(["bun", "scripts/validate-foundation.ts"], {
      cwd: repository,
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Foundation validation passed");
  });

  describe("root manifest gate", () => {
    test("accepts the accepted layout", async () => {
      expect(await validateRootManifest(validSandbox())).toEqual([]);
    });

    test("rejects a missing manifest", async () => {
      expect(await validateRootManifest(sandbox())).toEqual(["missing root package.json"]);
    });

    test("rejects package manager and manifest drift", async () => {
      const dir = validSandbox();
      const manifest = rootManifest();
      manifest.name = "@rootform/other";
      manifest.private = false;
      manifest.type = "commonjs";
      manifest.packageManager = "npm@10.0.0";
      manifest.engines = { bun: "1.2.0" };
      writeJson(join(dir, "package.json"), manifest);
      const joined = (await validateRootManifest(dir)).join("\n");
      expect(joined).toContain("root name must be @rootform/action");
      expect(joined).toContain("root package must be private");
      expect(joined).toContain("root type must be module");
      expect(joined).toContain(`root packageManager must be bun@${Bun.version}`);
      expect(joined).toContain("root engines.bun must equal running pinned Bun version");
    });

    test("rejects a changed, missing, or extra script", async () => {
      const dir = validSandbox();
      const manifest = rootManifest();
      manifest.scripts = {
        ...expectedRootScripts,
        verify: "bun scripts/verify.ts",
        lint: "eslint .",
      };
      writeJson(join(dir, "package.json"), manifest);
      const joined = (await validateRootManifest(dir)).join("\n");
      expect(joined).toContain('root script verify must be exactly "bun scripts/verify.ts --full"');
      expect(joined).toContain("unexpected root script: lint: eslint .");
    });

    test("rejects an unpinned, prerelease, or CDN dependency", async () => {
      const dir = validSandbox();
      const manifest = rootManifest();
      manifest.devDependencies = {
        "@biomejs/biome": "^2.5.8",
        typescript: "7.0.2-rc.1",
        vendored: "https://cdn.example.test/pkg.tgz",
      };
      writeJson(join(dir, "package.json"), manifest);
      const joined = (await validateRootManifest(dir)).join("\n");
      expect(joined).toContain("devDependencies.@biomejs/biome is not pinned exactly: ^2.5.8");
      expect(joined).toContain("devDependencies.typescript uses prerelease version: 7.0.2-rc.1");
      expect(joined).toContain("CDN or URL dependency spec is forbidden: devDependencies.vendored");
    });

    test("rejects foreign lockfiles and workspace declarations", async () => {
      const dir = validSandbox();
      writeText(join(dir, "yarn.lock"), "");
      writeJson(join(dir, "package.json"), { ...rootManifest(), workspaces: ["src"] });
      const joined = (await validateRootManifest(dir)).join("\n");
      expect(joined).toContain("foreign package-manager lockfile at repository root: yarn.lock");
      expect(joined).toContain(
        "the action repository publishes one package and declares no workspaces",
      );
    });
  });

  describe("action manifest gate", () => {
    test("accepts two entrypoints backed by committed bundles", async () => {
      expect(await validateActionManifests(actionSandbox())).toEqual([]);
    });

    test("stays silent before any action manifest exists", async () => {
      expect(await validateActionManifests(validSandbox())).toEqual([]);
    });

    test("rejects a manifest with no name, description, or runs section", async () => {
      const dir = validSandbox();
      writeText(join(dir, "action.yml"), "inputs:\n  version:\n    required: false\n");
      const joined = (await validateActionManifests(dir)).join("\n");
      expect(joined).toContain("action manifest action.yml needs a non-empty name");
      expect(joined).toContain("action manifest action.yml needs a non-empty description");
      expect(joined).toContain("action manifest action.yml needs a runs section");
    });

    test("rejects an unpinned runtime", async () => {
      const dir = actionSandbox();
      writeText(
        join(dir, "action.yml"),
        "name: Rootform\ndescription: Analyze Terraform\nruns:\n  using: composite\n  steps: []\n",
      );
      const joined = (await validateActionManifests(dir)).join("\n");
      expect(joined).toContain(
        "action manifest action.yml must run on a pinned Node runtime, got composite",
      );
    });

    test("rejects an entrypoint outside the committed bundle", async () => {
      const dir = actionSandbox();
      writeText(
        join(dir, "action.yml"),
        "name: Rootform\ndescription: Analyze Terraform\nruns:\n  using: node24\n  main: src/action.ts\n",
      );
      const joined = (await validateActionManifests(dir)).join("\n");
      expect(joined).toContain(
        "action manifest action.yml main must run committed bundle output: src/action.ts",
      );
    });

    test("rejects a manifest whose bundle is missing", async () => {
      const dir = actionSandbox();
      rmSync(join(dir, "dist", "setup.js"));
      const joined = (await validateActionManifests(dir)).join("\n");
      expect(joined).toContain(
        "action manifest setup/action.yml main bundle is missing: ../dist/setup.js",
      );
    });

    test("rejects a manifest that is not valid YAML mapping", async () => {
      const dir = validSandbox();
      writeText(join(dir, "action.yml"), "- name: Rootform\n");
      expect((await validateActionManifests(dir)).join("\n")).toContain(
        "action manifest must be a mapping: action.yml",
      );
    });
  });
});
