#!/usr/bin/env bun

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git, nullSeparated, repositoryRoot, run } from "./lib/git.ts";
import { isProductPath } from "./lib/policy.ts";
import { validateProductChangeGate } from "./lib/spec.ts";

type Gate = {
  command: string[];
  label: string;
};

const root = repositoryRoot();
const full = process.argv.includes("--full");

function runGate(gate: Gate): void {
  console.log(`\n==> ${gate.label}`);
  const result = run(gate.command, root);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

runGate({ command: ["bun", "run", "check"], label: "fast repository gate" });

if (!full) {
  console.log("\nFast verification passed.");
  process.exit(0);
}

const changedPaths = new Set<string>();
const workingChanges = git(["diff", "--name-only", "-z", "HEAD", "--"], root);
const untrackedChanges = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
if (workingChanges.exitCode !== 0 || untrackedChanges.exitCode !== 0) {
  console.error("cannot inspect working changes for spec gate");
  process.exit(1);
}
for (const path of [
  ...nullSeparated(workingChanges.stdout),
  ...nullSeparated(untrackedChanges.stdout),
]) {
  changedPaths.add(path);
}

const baseSha = process.env.ROOTFORM_BASE_SHA ?? "";
if (baseSha && baseSha !== "0".repeat(40)) {
  if (!/^[0-9a-f]{40}$/u.test(baseSha)) {
    console.error("ROOTFORM_BASE_SHA must be a full commit SHA");
    process.exit(1);
  }
  const committedChanges = git(["diff", "--name-only", "-z", baseSha, "HEAD", "--"], root);
  if (committedChanges.exitCode !== 0) {
    console.error(committedChanges.stderr.trim());
    process.exit(1);
  }
  for (const path of nullSeparated(committedChanges.stdout)) changedPaths.add(path);
}

const productPaths = [...changedPaths].filter(isProductPath);
const specErrors = await validateProductChangeGate(
  root,
  productPaths,
  process.env.ROOTFORM_HEAD_BRANCH,
);
if (specErrors.length > 0) {
  console.error(`Product spec gate failed:\n${specErrors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}

if (!Bun.which("gitleaks")) {
  console.error("gitleaks 8.30.1 is required for full verification");
  process.exit(1);
}

const gitleaksVersion = run(["gitleaks", "version"], root);
if (gitleaksVersion.exitCode !== 0 || gitleaksVersion.stdout.trim() !== "8.30.1") {
  console.error(`expected gitleaks 8.30.1, got ${gitleaksVersion.stdout.trim() || "unavailable"}`);
  process.exit(1);
}

const candidatesResult = git(
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  root,
);
if (candidatesResult.exitCode !== 0) {
  console.error(candidatesResult.stderr.trim());
  process.exit(1);
}

const scanRoot = mkdtempSync(join(tmpdir(), "rootform-public-scan-"));
try {
  for (const path of nullSeparated(candidatesResult.stdout)) {
    const source = join(root, path);
    if (!existsSync(source) || lstatSync(source).isDirectory()) continue;
    const destination = join(scanRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    if (lstatSync(source).isSymbolicLink()) {
      const target = join(dirname(source), readlinkSync(source));
      if (existsSync(target) && !lstatSync(target).isDirectory()) copyFileSync(target, destination);
    } else {
      copyFileSync(source, destination);
    }
  }

  runGate({
    command: [
      "gitleaks",
      "dir",
      "--no-banner",
      "--redact",
      "--config",
      join(root, ".gitleaks.toml"),
      scanRoot,
    ],
    label: "public working-set secret scan",
  });
} finally {
  rmSync(scanRoot, { force: true, recursive: true });
}

runGate({
  command: ["gitleaks", "git", "--no-banner", "--redact", "--config", ".gitleaks.toml", "."],
  label: "full Git history secret scan",
});

/* GitHub runs the committed bundle, not the sources beside it. A bundle that
   no longer matches its source would publish behavior nobody reviewed, so the
   gate rebuilds it and refuses any difference. */
if (existsSync(join(root, "src"))) {
  const manifest = await Bun.file(join(root, "package.json")).json();
  if (typeof manifest.scripts?.["build"] !== "string") {
    console.error("package.json must define a build script once src/ exists");
    process.exit(1);
  }
  runGate({ command: ["bun", "run", "build"], label: "action bundle" });
  const bundleDiff = git(["status", "--porcelain", "--", "dist"], root);
  if (bundleDiff.exitCode !== 0) {
    console.error(bundleDiff.stderr.trim());
    process.exit(1);
  }
  if (bundleDiff.stdout.trim()) {
    console.error(`committed bundle is stale:\n${bundleDiff.stdout}`);
    process.exit(1);
  }
}

console.log("\nFull verification passed.");
