#!/usr/bin/env bun

import { assertPublicMessage } from "../src/publication-safety.ts";
import { validateCommitSubject } from "./lib/commit-message.ts";
import { git, nullSeparated, repositoryRoot } from "./lib/git.ts";

const base = process.env.BASE_SHA ?? "";
const head = process.env.HEAD_SHA ?? "HEAD";
if (!/^[0-9a-f]{40}$/u.test(base) || !/^[0-9a-f]{40}$/u.test(head)) {
  console.error("BASE_SHA and HEAD_SHA must be full commit SHAs");
  process.exit(1);
}

const root = repositoryRoot();
const result = git(["log", "-z", "--format=%H%n%B", `${base}..${head}`], root);
if (result.exitCode !== 0) {
  console.error("Cannot inspect contribution commit messages");
  process.exit(result.exitCode);
}
const errors: string[] = [];
for (const entry of nullSeparated(result.stdout)) {
  const separator = entry.indexOf("\n");
  const commit = entry.slice(0, separator);
  const message = entry.slice(separator + 1);
  try {
    assertPublicMessage(message);
  } catch {
    errors.push(`${commit.slice(0, 12)}: unsafe contribution commit message`);
    continue;
  }
  const validation = validateCommitSubject(message);
  if (!validation.valid) errors.push(`${commit.slice(0, 12)}: ${validation.reason}`);
}
if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log("Commit range passed.");
