#!/usr/bin/env bun

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repositoryRoot } from "./lib/git.ts";

export const bundlePaths = ["main/index.js", "setup/index.js"] as const;

const entrypoints = {
  "main/index.js": "src/main-entry.ts",
  "setup/index.js": "src/setup-entry.ts",
} as const;

function portableBundle(contents: string, root: string): string {
  const toolCacheDirectory = join(root, "node_modules", "@actions", "tool-cache", "lib");
  const encodedDirectory = JSON.stringify(toolCacheDirectory);
  const occurrences = contents.split(encodedDirectory).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected one bundled @actions/tool-cache directory, got ${occurrences}`);
  }
  const portable = contents
    .replace(encodedDirectory, JSON.stringify("@actions/tool-cache/lib"))
    .replace(/[\t ]+$/gmu, "");
  if (portable.includes(root)) throw new Error("bundle contains repository build path");
  return portable;
}

export async function buildAction(outputRoot = join(repositoryRoot(), "dist")): Promise<void> {
  const root = repositoryRoot();
  rmSync(outputRoot, { force: true, recursive: true });

  for (const [output, entrypoint] of Object.entries(entrypoints)) {
    const result = await Bun.build({
      entrypoints: [join(root, entrypoint)],
      format: "esm",
      minify: true,
      sourcemap: "none",
      target: "node",
    });
    if (!result.success || result.outputs.length !== 1) {
      const diagnostics = result.logs.map((log) => log.message).join("\n");
      throw new Error(diagnostics || `failed to bundle ${entrypoint}`);
    }
    const destination = join(outputRoot, output);
    mkdirSync(dirname(destination), { recursive: true });
    const artifact = result.outputs[0];
    if (!artifact) throw new Error(`bundler returned no output for ${entrypoint}`);
    const contents = portableBundle(await artifact.text(), root);
    writeFileSync(destination, contents, {
      flag: "wx",
    });
  }
}

if (import.meta.main) {
  await buildAction();
}
