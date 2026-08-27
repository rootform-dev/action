import { describe, expect, test } from "bun:test";
import {
  decidePreToolUse,
  isPrivateTrackedPath,
  isProductPath,
  isProtectedWritePath,
  isSecretPath,
} from "./policy.ts";

const root = "/repo";

describe("secret and privacy paths", () => {
  test.each([
    ".env",
    "web/.env.local",
    ".dev.vars",
    "state.tfstate",
    "plan.tfplan",
    ".terraform/cache",
  ])("classifies %s as sensitive", (path) => expect(isSecretPath(path)).toBe(true));

  test.each([
    ".env.example",
    ".env.sample",
    ".dev.vars.example",
    "test/fixtures/plan.json",
    "src/installer.ts",
  ])("keeps safe source %s public", (path) => expect(isSecretPath(path)).toBe(false));

  test.each([
    "prd.md",
    ".ai-private/prompt.md",
    ".codex/config.toml",
    "docs/internal/roadmap.md",
    "x.private.md",
  ])("keeps %s private", (path) => expect(isPrivateTrackedPath(path)).toBe(true));
});

describe("product path gate", () => {
  test.each([
    "action.yml",
    "setup/action.yml",
    "src/action.ts",
    "src/installer.ts",
    "dist/index.js",
    "test/installer.test.ts",
  ])("classifies %s as product", (path) => expect(isProductPath(path)).toBe(true));

  test.each([
    "AGENTS.md",
    ".claude/settings.json",
    "scripts/verify.ts",
    "docs/engineering/quality-gates.md",
  ])("classifies %s as foundation", (path) => expect(isProductPath(path)).toBe(false));
});

describe("governed writes", () => {
  test.each(["prd.md", "docs/constitution.md", "LICENSE", "bun.lock", "dist/index.js"])(
    "blocks direct write to %s",
    (path) => expect(isProtectedWritePath(path)).toBeString(),
  );

  test.each(["AGENTS.md", "README.md", "scripts/check.ts", "src/installer.ts", "action.yml"])(
    "allows direct write to %s",
    (path) => expect(isProtectedWritePath(path)).toBeUndefined(),
  );
});

describe("PreToolUse policy", () => {
  test.each([
    "git reset --hard HEAD",
    "git clean -fd",
    "git push --force origin develop",
    "git rebase main",
    "rm -rf build",
    "terraform apply",
    "terraform state rm x",
    "gh repo delete rootform-dev/rootform",
    "gh release create v1",
    "git tag -f v1",
    "git tag --delete v1",
    "git commit --no-verify",
    "npm install zod",
    "pnpm test",
    "bunx biome check .",
    "bun x vite",
  ])("blocks dangerous Bash command: %s", (command) => {
    expect(decidePreToolUse({ tool_name: "Bash", tool_input: { command } }, root).allow).toBe(
      false,
    );
  });

  test.each([
    "git status --short",
    "git diff --check",
    "git add bun.lock",
    "bun install --frozen-lockfile",
    "bun run verify",
    "rg 'npm is forbidden' AGENTS.md",
    "terraform validate",
  ])("allows safe Bash command: %s", (command) => {
    expect(decidePreToolUse({ tool_name: "Bash", tool_input: { command } }, root)).toEqual({
      allow: true,
    });
  });

  test("blocks secret reads", () => {
    expect(
      decidePreToolUse({ tool_name: "Read", tool_input: { file_path: "/repo/.env" } }, root).allow,
    ).toBe(false);
  });

  test("blocks protected apply_patch targets", () => {
    const command =
      "*** Begin Patch\n*** Update File: /repo/docs/constitution.md\n@@\n-x\n+y\n*** End Patch";
    expect(
      decidePreToolUse({ tool_name: "apply_patch", tool_input: { command } }, root).allow,
    ).toBe(false);
  });

  test("allows ordinary apply_patch targets", () => {
    const command = "*** Begin Patch\n*** Update File: /repo/README.md\n@@\n-x\n+y\n*** End Patch";
    expect(decidePreToolUse({ tool_name: "apply_patch", tool_input: { command } }, root)).toEqual({
      allow: true,
    });
  });
});
