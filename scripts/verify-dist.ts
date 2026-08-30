#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAction, bundlePaths } from "./build.ts";
import { repositoryRoot } from "./lib/git.ts";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const root = repositoryRoot();
const first = mkdtempSync(join(tmpdir(), "rootform-action-dist-a-"));
const second = mkdtempSync(join(tmpdir(), "rootform-action-dist-b-"));

try {
  await buildAction(first);
  await buildAction(second);

  for (const relativePath of bundlePaths) {
    const committed = join(root, "dist", relativePath);
    const firstBuild = join(first, relativePath);
    const secondBuild = join(second, relativePath);
    if (!existsSync(committed)) throw new Error(`missing committed bundle: dist/${relativePath}`);
    const hashes = [committed, firstBuild, secondBuild].map(sha256);
    if (new Set(hashes).size !== 1) {
      throw new Error(`bundle is stale or nondeterministic: dist/${relativePath}`);
    }
    const contents = readFileSync(committed, "utf8");
    if (/\bBun\.|(?:from|import\()\s*["']bun:/u.test(contents)) {
      throw new Error(`Node bundle contains Bun runtime API: dist/${relativePath}`);
    }
    if (/\/Users\/[A-Za-z0-9._-]+\//u.test(contents)) {
      throw new Error(`Node bundle contains absolute personal path: dist/${relativePath}`);
    }
  }
} finally {
  rmSync(first, { force: true, recursive: true });
  rmSync(second, { force: true, recursive: true });
}

console.log("Action bundles are committed, deterministic, and Node-only.");
