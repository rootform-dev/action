#!/usr/bin/env bun

import { validatePullRequestMetadata } from "./lib/pr-metadata.ts";

const result = validatePullRequestMetadata(process.env.PR_TITLE ?? "", process.env.PR_BODY ?? "");
if (result.errors.length > 0) {
  console.error(result.errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Pull request metadata passed.");
