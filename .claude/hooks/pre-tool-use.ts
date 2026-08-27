#!/usr/bin/env bun

import { repositoryRoot } from "../../scripts/lib/git.ts";
import { decidePreToolUse, type HookInput } from "../../scripts/lib/policy.ts";

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = (await Bun.stdin.json()) as HookInput;
  } catch {
    console.error("Rootform policy blocked malformed hook input");
    process.exit(2);
  }

  const root = process.env.CLAUDE_PROJECT_DIR || repositoryRoot(input.cwd || process.cwd());
  const decision = decidePreToolUse(input, root);
  if (!decision.allow) {
    console.error(`Rootform policy blocked tool call: ${decision.reason}`);
    process.exit(2);
  }
}

await main();
