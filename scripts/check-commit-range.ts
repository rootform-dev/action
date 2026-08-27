#!/usr/bin/env bun

import { validateCommitSubject } from "./lib/commit-message.ts";
import { git, nullSeparated, repositoryRoot } from "./lib/git.ts";

const base = process.env.BASE_SHA ?? "";
const head = process.env.HEAD_SHA ?? "HEAD";
if (!/^[0-9a-f]{40}$/u.test(base) || !/^[0-9a-f]{40}$/u.test(head)) {
  console.error("BASE_SHA and HEAD_SHA must be full commit SHAs");
  process.exit(1);
}

const root = repositoryRoot();
const result = git(["log", "-z", "--format=%s", `${base}..${head}`], root);
if (result.exitCode !== 0) {
  console.error(result.stderr.trim());
  process.exit(result.exitCode);
}

const errors: string[] = [];
for (const subject of nullSeparated(result.stdout)) {
  const validation = validateCommitSubject(subject);
  if (!validation.valid) errors.push(`${subject}: ${validation.reason}`);
}
if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log("Commit range passed.");
