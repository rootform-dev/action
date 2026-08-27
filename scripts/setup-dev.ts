#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, repositoryRoot } from "./lib/git.ts";

const root = repositoryRoot();
const manifest = await Bun.file(join(root, "package.json")).json();

if (manifest.packageManager !== `bun@${Bun.version}`) {
  console.error(`Expected ${String(manifest.packageManager)}, running bun@${Bun.version}`);
  process.exit(1);
}
if (!existsSync(join(root, "node_modules", ".bin", "biome"))) {
  console.error("Run bun install --frozen-lockfile first.");
  process.exit(1);
}
if (!Bun.which("gitleaks")) {
  console.error("Install pinned Gitleaks 8.30.1 before enabling hooks.");
  process.exit(1);
}

const configuredHooks = git(["config", "--local", "--get", "core.hooksPath"], root);
const hooksPath = configuredHooks.stdout.trim();
if (configuredHooks.exitCode === 0 && hooksPath && hooksPath !== ".githooks") {
  console.log("Existing custom Git hooks path preserved; it must delegate to .githooks.");
} else {
  const result = git(["config", "--local", "core.hooksPath", ".githooks"], root);
  if (result.exitCode !== 0) {
    console.error(result.stderr.trim());
    process.exit(result.exitCode);
  }
  console.log("Git hooks installed from .githooks.");
}
console.log("Codex: review and trust project hooks with /hooks.");
