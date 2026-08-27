#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { repositoryRoot, run } from "../../scripts/lib/git.ts";
import { extractToolPaths, type HookInput } from "../../scripts/lib/policy.ts";

const BIOME_EXTENSIONS = new Set([".css", ".js", ".json", ".jsonc", ".jsx", ".ts", ".tsx"]);

function fail(message: string): never {
  console.error(`Rootform post-tool check failed: ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = (await Bun.stdin.json()) as HookInput;
  } catch {
    fail("malformed hook input");
  }

  const root = process.env.CLAUDE_PROJECT_DIR || repositoryRoot(input.cwd || process.cwd());
  const paths = extractToolPaths(input, root).filter((path) => existsSync(join(root, path)));
  if (paths.length === 0) return;

  const biomePaths = paths.filter((path) => BIOME_EXTENSIONS.has(extname(path).toLowerCase()));
  if (biomePaths.length > 0) {
    const biome = join(root, "node_modules", ".bin", "biome");
    if (!existsSync(biome)) fail("Biome is not installed; run bun install --frozen-lockfile");
    const result = run(
      [biome, "check", "--write", "--no-errors-on-unmatched", ...biomePaths],
      root,
    );
    if (result.exitCode !== 0) fail(result.stderr.trim() || result.stdout.trim());
  }

  if (paths.some((path) => /\.(?:ts|tsx)$/u.test(path))) {
    const result = run(["bun", "run", "typecheck"], root);
    if (result.exitCode !== 0) fail(result.stderr.trim() || result.stdout.trim());
  }

  if (
    paths.some((path) =>
      /^(?:\.agents|\.claude|\.codex|\.github|docs|scripts|specs|setup)\//u.test(path),
    ) ||
    paths.some((path) => /^action\.ya?ml$/u.test(path))
  ) {
    const result = run(["bun", "scripts/validate-foundation.ts"], root);
    if (result.exitCode !== 0) fail(result.stderr.trim() || result.stdout.trim());
  }
}

await main();
