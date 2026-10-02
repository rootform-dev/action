#!/usr/bin/env bun

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repositoryRoot } from "./lib/git.ts";

export const actionKinds = ["main", "setup", "init", "analyze", "compare", "check"] as const;
export const bundlePaths = ["shared/index.js", ...actionKinds.map((kind) => `${kind}/index.js`)];

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

  const result = await Bun.build({
    entrypoints: [join(root, "src/main.ts")],
    format: "esm",
    minify: true,
    sourcemap: "none",
    target: "node",
  });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") || "failed to bundle shared runtime",
    );
  }
  const shared = join(outputRoot, "shared/index.js");
  mkdirSync(dirname(shared), { recursive: true });
  const artifact = result.outputs[0];
  if (!artifact) throw new Error("bundler returned no shared runtime");
  writeFileSync(shared, portableBundle(await artifact.text(), root), { flag: "wx" });
  for (const kind of actionKinds) {
    const source = await Bun.file(join(root, `src/${kind}-entry.ts`)).text();
    if (source.split('"./main.ts"').length !== 2)
      throw new Error(`unexpected ${kind} entrypoint import`);
    const destination = join(outputRoot, kind, "index.js");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source.replace('"./main.ts"', '"../shared/index.js"'), {
      flag: "wx",
    });
  }
}

if (import.meta.main) {
  await buildAction();
}
