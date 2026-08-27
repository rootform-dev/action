#!/usr/bin/env bun

import { validateCommitSubject } from "./lib/commit-message.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let message = "";

  if (args[0] === "--file" && args[1]) message = await Bun.file(args[1]).text();
  else if (args[0] === "--message" && args[1]) message = args.slice(1).join(" ");
  else message = await Bun.stdin.text();

  const result = validateCommitSubject(message);
  if (!result.valid) {
    console.error(`Invalid commit message: ${result.reason}`);
    process.exit(1);
  }
}

await main();
