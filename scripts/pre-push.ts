#!/usr/bin/env bun

import { git, repositoryRoot, run } from "./lib/git.ts";

const ZERO_SHA = "0".repeat(40);
const root = repositoryRoot();
const updates = (await Bun.stdin.text()).trim().split("\n").filter(Boolean);

if (updates.length === 0) {
  const result = run(["bun", "scripts/verify.ts", "--full"], root);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

for (const update of updates) {
  const [localRef, localSha, , remoteSha] = update.trim().split(/\s+/u);
  if (!localRef?.startsWith("refs/heads/") || !localSha || localSha === ZERO_SHA) continue;

  const branch = localRef.slice("refs/heads/".length);
  let base = remoteSha && remoteSha !== ZERO_SHA ? remoteSha : "";
  /* A base scopes the spec gate to what this push adds. Without an integration
     branch to compare against there is nothing to narrow, so the gate runs
     over the whole working tree instead of refusing the push. */
  if (!base && git(["rev-parse", "--verify", "--quiet", "origin/dev"], root).exitCode === 0) {
    const mergeBase = git(["merge-base", localSha, "origin/dev"], root);
    if (mergeBase.exitCode !== 0) {
      console.error("Cannot determine dev merge-base for new branch.");
      process.exit(1);
    }
    base = mergeBase.stdout.trim();
  }

  const result = Bun.spawnSync(["bun", "scripts/verify.ts", "--full"], {
    cwd: root,
    env: { ...process.env, ROOTFORM_BASE_SHA: base, ROOTFORM_HEAD_BRANCH: branch },
    stderr: "pipe",
    stdout: "pipe",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
