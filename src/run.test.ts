import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type CommandRunner, type RunOptions, runBusiness } from "./run.ts";

const cleanup: string[] = [];
afterEach(() => {
  for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function scenario(
  changes: Partial<RunOptions> = {},
  fail?: { command: string; code: number; write: boolean },
) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "rootform-command-unit-")));
  cleanup.push(workspace);
  const outputDirectory = join(workspace, "outputs");
  mkdirSync(outputDirectory);
  for (const file of ["plan.json", "after.json", "plan.tfplan", "after.tfplan"])
    writeFileSync(join(workspace, file), "transport-input");
  const saved = join(workspace, "saved.json");
  writeFileSync(saved, '{"generator":{"name":"rootform"}}');
  const commands: string[][] = [];
  const directories: string[] = [];
  const runner: CommandRunner = (command, cwd) => {
    commands.push(command);
    directories.push(cwd);
    const matches = command[1] === fail?.command;
    if (!matches || fail?.write)
      for (let i = 0; i < command.length; i++) {
        if (command[i] === "-o" && command[i + 1])
          writeFileSync(command[i + 1] as string, "CLI bytes");
      }
    return { exitCode: matches ? fail?.code || 0 : 0, stderr: matches ? "CLI diagnostic" : "" };
  };
  const result = runBusiness({
    binary: "rootform",
    kind: "analyze",
    input: join(workspace, "plan.json"),
    project: workspace,
    workspace,
    locked: false,
    policies: [],
    policyPacks: [],
    check: false,
    outputDirectory,
    runner,
    ...changes,
  });
  return { result, commands, directories, workspace, saved, outputDirectory };
}

describe("current CLI command transport", () => {
  test("one raw analysis produces Form/Markdown/HTML together", () => {
    const f = scenario();
    expect(f.result.failure).toBeUndefined();
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]?.slice(0, 4)).toEqual(["rootform", "run", "plan.json", "--no-serve"]);
    expect(f.commands[0]?.filter((v) => v === "-o")).toHaveLength(3);
    expect(f.commands.flat()).not.toContain("--plan");
    expect(f.result.exitCode).toBeUndefined();
  });

  test("saved Form reopens with no acquisition or new Form output", () => {
    const f = scenario();
    const original = readFileSync(f.saved);
    const commands: string[][] = [];
    const result = runBusiness({
      binary: "rootform",
      kind: "analyze",
      input: f.saved,
      project: f.workspace,
      workspace: f.workspace,
      locked: false,
      policies: [],
      policyPacks: [],
      check: false,
      outputDirectory: f.outputDirectory,
      runner: (command) => {
        commands.push(command);
        for (let i = 0; i < command.length; i++)
          if (command[i] === "-o") writeFileSync(command[i + 1] as string, "reopened");
        return { exitCode: 0, stderr: "" };
      },
    });
    expect(result.paths.form).toBe(f.saved);
    expect(readFileSync(f.saved)).toEqual(original);
    expect(commands[0]).not.toContain("--locked");
    expect(commands[0]).not.toContain("--project");
    expect(commands[0]?.filter((v) => v === "-o")).toHaveLength(2);
  });

  test("explicit saved plan requires verified pairing without analysis duplication", () => {
    const f = scenario();
    const g = scenario({ planFile: join(f.workspace, "plan.tfplan") });
    expect(g.commands[0]).toContain("--plan-file");
    expect(g.commands[0]).toContain("--require-enrichment");
    expect(g.commands).toHaveLength(1);
  });

  test("raw check analyzes once then evaluates once with three outputs", () => {
    const f = scenario({ kind: "check", side: "after", policies: ["security/*"] });
    expect(f.commands.map((c) => c[1])).toEqual(["run", "check"]);
    expect(f.commands[0]?.filter((v) => v === "-o")).toHaveLength(1);
    expect(f.commands[1]?.filter((v) => v === "-o")).toHaveLength(3);
    expect(f.commands[1]?.[2]).toBe("form.json");
    expect(f.directories[1]).toBe(f.outputDirectory);
    expect(f.result.paths.html).toBeUndefined();
    expect(f.result.exitCode).toBe(0);
  });

  test("negative check keeps exact status and every derived report", () => {
    const f = scenario({ kind: "check" }, { command: "check", code: 3, write: true });
    expect(f.result.exitCode).toBe(3);
    expect(f.result.failure?.message).toBe("CLI diagnostic");
    expect(Object.keys(f.result.paths).sort()).toEqual(["form", "report", "result", "sarif"]);
  });

  test("failed compilation never evaluates or fabricates a Form", () => {
    const f = scenario({ kind: "check" }, { command: "run", code: 3, write: false });
    expect(f.commands).toHaveLength(1);
    expect(f.result.paths).toEqual({});
    expect(f.result.exitCode).toBeUndefined();
  });

  test("a zero exit with missing output fails explicitly", () => {
    const f = scenario();
    const result = runBusiness({
      binary: "rootform",
      kind: "check",
      input: join(f.workspace, "plan.json"),
      project: f.workspace,
      workspace: f.workspace,
      locked: false,
      policies: [],
      policyPacks: [],
      check: false,
      outputDirectory: join(f.workspace, "missing"),
      runner: () => ({ exitCode: 0, stderr: "" }),
    });
    expect(result.failure?.message).toContain("without every requested output");
    expect(result.paths).toEqual({});
  });

  test("two raw operands compare in one CLI analysis with stage selection", () => {
    const f = scenario();
    const g = scenario({
      kind: "compare",
      input: undefined,
      before: join(f.workspace, "plan.json"),
      after: join(f.workspace, "after.json"),
      beforeStage: "recorded",
      afterStage: "planned",
    });
    expect(g.commands).toHaveLength(1);
    expect(g.commands[0]).toContain("--diff");
    expect(g.commands[0]).toContain("--before-stage");
    expect(g.commands[0]).toContain("--after-stage");
    expect(g.commands[0]?.[1]).toBe("run");
  });

  test("locked mixed operands normalize raw once and never apply acquisition flags to saved operand", () => {
    const f = scenario();
    const g = scenario({
      kind: "compare",
      input: undefined,
      before: f.saved,
      after: join(f.workspace, "after.json"),
      locked: true,
    });
    expect(g.commands.map((c) => c[1])).toEqual(["run", "run"]);
    expect(g.commands[0]).toContain("--locked");
    expect(g.commands[1]).not.toContain("--locked");
    expect(g.commands[1]).not.toContain("--project");
    expect(Object.keys(g.result.paths)).not.toContain("before-form");
  });

  test("optional saved plans are paired per side; comparison only loads those Forms", () => {
    const f = scenario();
    const g = scenario({
      kind: "compare",
      input: undefined,
      before: join(f.workspace, "plan.json"),
      after: join(f.workspace, "after.json"),
      beforePlanFile: join(f.workspace, "plan.tfplan"),
    });
    expect(g.commands.map((c) => c[1])).toEqual(["run", "run", "run"]);
    expect(g.commands[0]).toContain("--require-enrichment");
    expect(g.commands[1]).not.toContain("--require-enrichment");
    expect(g.commands[2]).not.toContain("--require-enrichment");
    expect(basename(g.result.paths.form || "")).toBe("form.json");
  });
});
