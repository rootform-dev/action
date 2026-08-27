#!/usr/bin/env bun

import { git, nullSeparated, repositoryRoot, run } from "../../scripts/lib/git.ts";
import { type HookInput, isProductPath } from "../../scripts/lib/policy.ts";
import { validateProductChangeGate } from "../../scripts/lib/spec.ts";

function stop(reason: string): never {
  console.error(`Rootform Done-when guard: ${reason}`);
  process.exit(2);
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = (await Bun.stdin.json()) as HookInput;
  } catch {
    stop("malformed hook input");
  }

  if (input.stop_hook_active) {
    console.log("{}");
    return;
  }

  const root = process.env.CLAUDE_PROJECT_DIR || repositoryRoot(input.cwd || process.cwd());
  const tracked = git(["diff", "--name-only", "-z", "HEAD", "--"], root);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  if (tracked.exitCode !== 0 || untracked.exitCode !== 0) stop("cannot inspect changed files");

  const changed = [
    ...new Set([...nullSeparated(tracked.stdout), ...nullSeparated(untracked.stdout)]),
  ];
  if (changed.length === 0) {
    console.log("{}");
    return;
  }

  const productPaths = changed.filter(isProductPath);
  const specErrors = await validateProductChangeGate(root, productPaths);
  if (specErrors.length > 0) stop(specErrors.join("; "));

  const check = run(["bun", "run", "check:fast"], root);
  if (check.exitCode !== 0) {
    const output = `${check.stdout}\n${check.stderr}`.trim().split("\n").slice(-40).join("\n");
    stop(`fast gate failed\n${output}`);
  }

  console.log("{}");
}

await main();
