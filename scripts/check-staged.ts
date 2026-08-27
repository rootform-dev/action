#!/usr/bin/env bun

import { git, nullSeparated, repositoryRoot, run } from "./lib/git.ts";
import { isForbiddenPackageManagerLock, isPrivateTrackedPath, isSecretPath } from "./lib/policy.ts";

const root = repositoryRoot();
const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root);
if (staged.exitCode !== 0) {
  console.error(staged.stderr.trim());
  process.exit(1);
}

const errors: string[] = [];
for (const path of nullSeparated(staged.stdout)) {
  if (isPrivateTrackedPath(path) || isSecretPath(path))
    errors.push(`private or sensitive staged path: ${path}`);
  if (isForbiddenPackageManagerLock(path) || path.endsWith("bun.lockb"))
    errors.push(`foreign lockfile staged: ${path}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

if (Bun.which("gitleaks")) {
  const result = run(
    ["gitleaks", "git", "--staged", "--no-banner", "--redact", "--config", ".gitleaks.toml", "."],
    root,
  );
  if (result.exitCode !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.exitCode);
  }
} else {
  console.error("gitleaks is required for pre-commit secret scanning");
  process.exit(1);
}

console.log("Staged paths and secrets passed.");
