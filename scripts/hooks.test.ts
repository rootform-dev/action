import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function hook(path: string, input: object) {
  return Bun.spawnSync(["bun", path], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stdin: new Blob([JSON.stringify(input)]),
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe("hook adapters", () => {
  test("PreToolUse exits 2 for protected path", () => {
    const result = hook(".claude/hooks/pre-tool-use.ts", {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: join(root, "prd.md") },
      tool_name: "Write",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("private PRD");
  });

  test("PreToolUse exits 0 for safe read", () => {
    const result = hook(".claude/hooks/pre-tool-use.ts", {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: join(root, "README.md") },
      tool_name: "Read",
    });
    expect(result.exitCode).toBe(0);
  });

  test("PostToolUse validates a touched tooling file", () => {
    const result = hook(".claude/hooks/post-tool-use.ts", {
      hook_event_name: "PostToolUse",
      tool_input: { file_path: join(root, "scripts/hooks.test.ts") },
      tool_name: "Write",
    });
    expect(result.exitCode).toBe(0);
  });

  test("PreToolUse blocks a published tag from being moved", () => {
    const result = hook(".claude/hooks/pre-tool-use.ts", {
      hook_event_name: "PreToolUse",
      tool_input: { command: "git tag -f v1" },
      tool_name: "Bash",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("published tag");
  });

  test("PreToolUse blocks hand-editing the committed bundle", () => {
    const result = hook(".claude/hooks/pre-tool-use.ts", {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: join(root, "dist/index.js") },
      tool_name: "Write",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("generated or dependency output");
  });

  test("Stop anti-loop returns valid empty JSON", () => {
    const result = hook(".claude/hooks/done-when.ts", {
      hook_event_name: "Stop",
      stop_hook_active: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("{}");
  });

  test("malformed hook input fails closed", () => {
    const result = Bun.spawnSync(["bun", ".claude/hooks/pre-tool-use.ts"], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: new Blob(["not-json"]),
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(2);
  });
});
