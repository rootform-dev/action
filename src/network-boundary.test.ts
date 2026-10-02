import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./run.ts";

test("GitHub and Action credentials are absent in a real CLI child process", () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-cli-environment-"));
  const forbidden = [
    ["GITHUB_TOKEN", "github-token-sentinel"],
    ["GH_TOKEN", "gh-token-sentinel"],
    ["ACTIONS_RUNTIME_TOKEN", "runtime-token-sentinel"],
    ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", "oidc-token-sentinel"],
    ["INPUT_GITHUB-TOKEN", "release-token-sentinel"],
    ["INPUT_PULL-REQUEST-TOKEN", "comment-token-sentinel"],
    ["INPUT_CUSTOM", "input-token-sentinel"],
    ["input_case_variant", "input-case-token-sentinel"],
  ] as const;
  const preserved = ["ROOTFORM_HOME", "GITHUB_WORKSPACE", "ROOTFORM_TEST_SAFE"] as const;
  const variableNames = [...forbidden.map(([name]) => name), ...preserved];
  const previous = new Map(variableNames.map((name) => [name, process.env[name]]));
  const rootformHome = join(workspace, "rootform-home");
  process.env.ROOTFORM_HOME = rootformHome;
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.ROOTFORM_TEST_SAFE = "ordinary-value-preserved";
  for (const [name, value] of forbidden) process.env[name] = value;

  try {
    const blockedNames = forbidden.map(([name]) => name.toUpperCase());
    const childScript = `
      const blocked = new Set(${JSON.stringify(blockedNames)});
      const excluded = Object.keys(process.env)
        .filter((name) => name.toUpperCase().startsWith("INPUT_") || blocked.has(name.toUpperCase()))
        .sort();
      process.stdout.write(JSON.stringify({
        excluded,
        rootformHome: process.env.ROOTFORM_HOME,
        workspace: process.env.GITHUB_WORKSPACE,
        safe: process.env.ROOTFORM_TEST_SAFE,
        path: process.env.PATH,
        ci: process.env.CI,
        noColor: process.env.NO_COLOR,
      }));
    `;
    const result = runCommand([process.execPath, "-e", childScript], workspace);

    expect(result.exitCode).toBe(0);
    const observed = JSON.parse(result.stdout ?? "") as {
      excluded: string[];
      rootformHome: string;
      workspace: string;
      safe: string;
      path: string | undefined;
      ci: string;
      noColor: string;
    };
    expect(observed).toEqual({
      excluded: [],
      rootformHome,
      workspace,
      safe: "ordinary-value-preserved",
      path: process.env.PATH,
      ci: "true",
      noColor: "1",
    });
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(workspace, { force: true, recursive: true });
  }
});
