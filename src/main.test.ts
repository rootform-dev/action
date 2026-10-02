import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type MainDependencies, main } from "./main.ts";
import type { CommandRunner } from "./run.ts";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(inputs: Record<string, string> = {}, checkExit = 0) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "rootform-action-unit-")));
  cleanup.push(workspace);
  writeFileSync(join(workspace, "input.json"), "{}");
  writeFileSync(join(workspace, "after.json"), "{}");
  // Deliberately a transport header, not a semantic Form mock. Published CLI
  // integration owns real acceptance; these tests exercise orchestration only.
  writeFileSync(join(workspace, "saved.json"), '{"generator":{"name":"rootform"}}');
  const values = {
    version: "0.1.0-pr.117.1",
    input: "input.json",
    "github-token": "unit-secret",
    ...inputs,
  };
  const outputs = new Map<string, string>();
  const events: string[] = [];
  const commands: string[][] = [];
  const artifacts: { name: string; files: string[]; retention: number }[] = [];
  const summaries: string[] = [];
  const failures: string[] = [];
  const environment: NodeJS.ProcessEnv = {
    GITHUB_WORKSPACE: workspace,
    RUNNER_TEMP: workspace,
    GITHUB_JOB: "matrix",
  };
  const runner: CommandRunner = (command) => {
    commands.push(command);
    events.push(`cli:${command[1]}`);
    for (let i = 0; i < command.length; i++) {
      if (command[i] === "-o" && command[i + 1]) {
        const file = command[i + 1] as string;
        writeFileSync(
          file,
          file.endsWith(".md") ? `EXACT ${command[1]} CLI MARKDOWN\n` : "derived-output",
        );
      }
    }
    return { exitCode: command[1] === "check" ? checkExit : 0, stderr: "", stdout: "" };
  };
  const dependencies: MainDependencies = {
    core: {
      getInput: (name) => values[name as keyof typeof values] || "",
      setOutput: (name, value) => {
        events.push(`output:${name}`);
        outputs.set(name, String(value));
      },
      setFailed: (value) => {
        events.push("failed");
        failures.push(String(value));
      },
      setSecret: () => {
        events.push("masked");
      },
      exportVariable: (name, value) => {
        environment[name] = String(value);
      },
      warning: () => {
        events.push("warning");
      },
      summary: {
        addRaw: (value) => ({
          write: async () => {
            events.push("summary");
            summaries.push(value);
          },
        }),
      },
    },
    environment,
    install: async ({ version, token }) => {
      events.push("install");
      expect(token).toBe("unit-secret");
      return { binary: "rootform", version, sha256: "a".repeat(64) };
    },
    context: () => ({
      eventName: "push",
      workflowUrl: "https://github.com/example/project/actions/runs/1",
    }),
    comment: async () => {
      events.push("comment");
      return {
        action: "updated",
        id: 1,
        htmlUrl: "https://github.com/example/project/pull/1#issuecomment-1",
      };
    },
    runner,
    artifactClient: () => ({
      uploadArtifact: async (name, files, root, options) => {
        events.push("artifact");
        expect(files.every((file) => file.startsWith(root))).toBe(true);
        artifacts.push({
          name,
          files: files.map((file) => basename(file)),
          retention: options.retentionDays,
        });
        return {
          id: 7,
          size: 100,
          digest: "a".repeat(64),
        };
      },
    }),
    cacheClient: () => ({
      restore: async () => {
        events.push("restore");
        return undefined;
      },
      save: async () => {
        events.push("save");
      },
    }),
  };
  return {
    dependencies,
    outputs,
    events,
    commands,
    artifacts,
    summaries,
    failures,
    workspace,
    environment,
  };
}

describe("shared Action orchestration", () => {
  test("setup installs only; init prepares only", async () => {
    const setup = fixture();
    await main("setup", setup.dependencies);
    expect(setup.commands).toEqual([]);
    expect([...setup.outputs.keys()]).toEqual(["version", "sha256"]);
    expect(setup.environment.ROOTFORM_HOME).toBeUndefined();
    const init = fixture({ input: "", locked: "true", offline: "true" });
    await main("init", init.dependencies);
    expect(init.commands.map((c) => c[1])).toEqual(["init"]);
    expect(init.commands[0]).toContain("--locked");
    expect(init.commands[0]).toContain("--offline");
    expect([...init.outputs.keys()]).toEqual(["version"]);
    expect(init.artifacts).toEqual([]);
  });

  test("analyze is autonomous, compiles once, uploads only derived evidence", async () => {
    const f = fixture();
    await main("analyze", f.dependencies);
    expect(f.failures).toEqual([]);
    expect(f.commands.map((c) => c[1])).toEqual(["init", "run"]);
    expect(f.commands[1]?.filter((value) => value === "-o")).toHaveLength(3);
    expect(f.artifacts[0]?.files.sort()).toEqual(["explorer.html", "form.json", "report.md"]);
    expect(f.artifacts[0]?.retention).toBe(7);
    expect(f.outputs.get("artifact-url")).toBe(
      "https://github.com/example/project/actions/runs/1/artifacts/7",
    );
    expect(f.outputs.get("form")).not.toContain("derived-output");
    expect(existsSync(f.outputs.get("form") || "")).toBe(true);
    expect(f.summaries[0]).toContain("EXACT run CLI MARKDOWN");
    expect(f.events).not.toContain("restore");
  });

  test("compare accepts independent operands and emits no operand outputs", async () => {
    const f = fixture({ input: "", before: "input.json", after: "after.json" });
    await main("compare", f.dependencies);
    expect(f.failures).toEqual([]);
    expect(f.commands.map((c) => c[1])).toEqual(["init", "run"]);
    expect(f.commands[1]).toContain("--diff");
    expect(f.outputs.has("before-form")).toBe(false);
    expect(f.outputs.has("after-form")).toBe(false);
    expect(f.outputs.has("result")).toBe(false);
  });

  for (const exitCode of [0, 1, 2, 3, 4]) {
    test(`check direct publishes every available proof before gate ${exitCode}`, async () => {
      const f = fixture({}, exitCode);
      await main("check", f.dependencies);
      expect(f.commands.map((c) => c[1])).toEqual(["init", "run", "check"]);
      expect(f.commands.filter((c) => c[1] === "check")).toHaveLength(1);
      expect(f.outputs.get("exit-code")).toBe(String(exitCode));
      expect(f.artifacts[0]?.files.sort()).toEqual([
        "form.json",
        "report.md",
        "result.json",
        "results.sarif",
      ]);
      expect(f.outputs.has("html")).toBe(false);
      expect(f.failures.length).toBe(exitCode === 0 ? 0 : 1);
      if (exitCode !== 0) {
        const failed = f.events.indexOf("failed");
        expect(f.events.indexOf("artifact")).toBeLessThan(failed);
        expect(f.events.indexOf("summary")).toBeLessThan(failed);
        expect(f.events.indexOf("output:form")).toBeLessThan(failed);
        expect(f.events.indexOf("output:exit-code")).toBeLessThan(failed);
      }
    });
  }

  test("saved Form check validates/reuses bytes without analysis, forwarding side and Policies", async () => {
    const f = fixture({
      input: "saved.json",
      side: "after",
      policy: "security/*\nbaseline/network",
    });
    const original = readFileSync(join(f.workspace, "saved.json"));
    await main("check", f.dependencies);
    expect(f.commands.map((c) => c[1])).toEqual(["init", "validate", "check"]);
    expect(f.commands[2]).toContain("--side");
    expect(f.commands[2]).toContain("after");
    expect(f.commands[2]?.filter((arg) => arg === "--policy")).toHaveLength(2);
    expect(f.outputs.get("form")).toBe(join(f.workspace, "saved.json"));
    expect(readFileSync(join(f.workspace, "saved.json"))).toEqual(original);
  });

  test("saved analyze skips preparation and root default makes no implicit Policy claim", async () => {
    const f = fixture({ input: "saved.json" });
    await main("main", f.dependencies);
    expect(f.commands.map((c) => c[1])).toEqual(["run"]);
    expect(f.outputs.get("form")).toBe(join(f.workspace, "saved.json"));
    expect(f.outputs.has("exit-code")).toBe(false);
    expect(f.outputs.has("result")).toBe(false);
  });

  test("root combines exact architecture/Policy reports and publishes comment before failed gate", async () => {
    const f = fixture({ check: "true", comment: "true" }, 1);
    f.dependencies.context = () => ({
      eventName: "pull_request",
      runId: "1",
      runAttempt: "1",
      pullRequest: {
        apiUrl: "https://api.github.com",
        number: 1,
        repository: "example/project",
        sameRepository: true,
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
      },
    });
    await main("main", f.dependencies);
    const report = readFileSync(f.outputs.get("report") || "", "utf8");
    expect(report).toContain("EXACT run CLI MARKDOWN");
    expect(report).toContain("EXACT check CLI MARKDOWN");
    expect(f.events.indexOf("comment")).toBeLessThan(f.events.indexOf("failed"));
    expect(f.events.indexOf("summary")).toBeLessThan(f.events.indexOf("failed"));
  });

  test("publication failure does not suppress the other evidence channel", async () => {
    const f = fixture({}, 1);
    f.dependencies.artifactClient = () => ({
      uploadArtifact: async () => {
        f.events.push("artifact");
        throw new Error("transport failed");
      },
    });
    await main("check", f.dependencies);
    expect(f.outputs.has("result")).toBe(true);
    expect(f.events).toContain("summary");
    expect(f.failures[0]).toContain("transport failed");
    expect(f.events.at(-1)).toBe("failed");
  });

  test("disabled publication retains reusable files and exact negative status", async () => {
    const f = fixture({ "upload-artifact": "false", summary: "false" }, 3);
    await main("check", f.dependencies);
    expect(f.artifacts).toEqual([]);
    expect(f.summaries).toEqual([]);
    expect(f.outputs.get("exit-code")).toBe("3");
    expect(existsSync(f.outputs.get("result") || "")).toBe(true);
    expect(f.failures).toHaveLength(1);
  });

  test("ROOTFORM_HOME and exact version survive repeated steps; default artifacts never collide", async () => {
    const f = fixture();
    await main("analyze", f.dependencies);
    const home = f.environment.ROOTFORM_HOME;
    expect(home).toBe(join(f.workspace, "rootform-home"));
    await main("analyze", f.dependencies);
    expect(f.environment.ROOTFORM_HOME).toBe(home);
    expect(f.environment.ROOTFORM_VERSION).toBe("0.1.0-pr.117.1");
    expect(f.artifacts).toHaveLength(2);
    expect(f.artifacts[0]?.name).not.toBe(f.artifacts[1]?.name);
  });

  test("cached sources are verified by init after restore; a failed init never runs analysis", async () => {
    const f = fixture();
    writeFileSync(join(f.workspace, "rootform.lock"), "cache-key-bytes");
    f.dependencies.runner = (command) => {
      f.events.push(`cli:${command[1]}`);
      return { exitCode: 3, stderr: "selected content unavailable" };
    };
    await main("analyze", f.dependencies);
    expect(f.events.indexOf("restore")).toBeLessThan(f.events.indexOf("cli:init"));
    expect(f.events).not.toContain("save");
    expect(f.events).not.toContain("cli:run");
    expect(f.outputs.has("form")).toBe(false);
    expect(f.failures[0]).toContain("selected content unavailable");
  });

  test("fork comment is skipped; privileged target is rejected before install", async () => {
    const f = fixture({ comment: "true" });
    f.dependencies.context = () => ({
      eventName: "pull_request",
      pullRequest: {
        apiUrl: "https://api.github.com",
        number: 1,
        repository: "example/project",
        sameRepository: false,
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
      },
    });
    await main("main", f.dependencies);
    expect(f.events).not.toContain("comment");
    expect(f.summaries[0]).toContain("skipped");
    const target = fixture();
    target.environment.GITHUB_EVENT_NAME = "pull_request_target";
    await main("analyze", target.dependencies);
    expect(target.events).not.toContain("install");
    expect(target.commands).toEqual([]);
    expect(target.failures[0]).toContain("pull_request_target");
  });

  test("errors redact GitHub tokens and runner roots", async () => {
    const f = fixture();
    f.dependencies.install = async () => {
      throw new Error(`unit-secret ${f.workspace}/private`);
    };
    await main("analyze", f.dependencies);
    expect(f.failures[0]).toContain("***");
    expect(f.failures[0]).not.toContain("unit-secret");
    expect(f.failures[0]).not.toContain(f.workspace);
  });

  test("conflicting files, inappropriate saved flags and invalid booleans fail explicitly", async () => {
    const invalid: Record<string, string>[] = [
      { before: "input.json", after: "after.json" },
      { input: "saved.json", locked: "true" },
      { summary: "maybe" },
    ];
    for (const values of invalid) {
      const f = fixture(values);
      await main("analyze", f.dependencies);
      expect(f.failures).toHaveLength(1);
      expect(f.commands).toEqual([]);
    }
  });
});
