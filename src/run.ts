import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { cliEnvironment } from "./environment.ts";

export type BusinessKind = "main" | "analyze" | "compare" | "check";
export type OutputName = "form" | "result" | "report" | "html" | "sarif";
export type ResultPaths = Partial<Record<OutputName, string>>;
export type CommandResult = { exitCode: number; stderr: string; stdout?: string };
export type CommandRunner = (command: string[], cwd: string) => CommandResult;

export class RootformCommandError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RootformCommandError";
  }
}

export const runCommand: CommandRunner = (command, cwd) => {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Rootform command is empty");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: { ...cliEnvironment(), CI: "true", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw new Error("Rootform process failed or exceeded its execution limit");
  if (result.status === null) throw new Error("Rootform process ended without an exit status");
  return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout };
};

// This transport hint reads no architecture or Policy result. The CLI still
// validates/classifies the entire input; malformed or unknown JSON goes to it.
export function savedFormHint(path: string): boolean {
  try {
    if (lstatSync(path).size > 64 * 1024 * 1024) return false;
    const header: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!header || typeof header !== "object" || Array.isArray(header)) return false;
    const generator = (header as { generator?: { name?: unknown } }).generator;
    return generator?.name === "rootform";
  } catch {
    return false;
  }
}

export type RunOptions = {
  binary: string;
  kind: BusinessKind;
  input?: string;
  before?: string;
  after?: string;
  planFile?: string;
  beforePlanFile?: string;
  afterPlanFile?: string;
  project: string;
  locked: boolean;
  stage?: string;
  beforeStage?: string;
  afterStage?: string;
  side?: string;
  policies: string[];
  policyPacks: string[];
  check: boolean;
  outputDirectory: string;
  workspace: string;
  runner?: CommandRunner;
};
export type ExecutionResult = {
  paths: ResultPaths;
  exitCode?: number;
  failure?: RootformCommandError | Error;
  reports: string[];
};

export function runBusiness(options: RunOptions): ExecutionResult {
  const runner = options.runner ?? runCommand;
  const paths: ResultPaths = {};
  const candidates: ResultPaths = {};
  const reports: string[] = [];
  let exitCode: number | undefined;
  const destination = (file: string) => join(options.outputDirectory, file);
  const projectFlags = (locked = options.locked) => [
    "--project",
    options.project,
    ...(locked ? ["--locked"] : []),
  ];
  const flag = (name: string, value: string | undefined) => (value ? [name, value] : []);
  const pair = (file: string | undefined) =>
    file ? ["--plan-file", file, "--require-enrichment"] : [];
  const invoke = (args: string[], outputs: string[], check = false, cwd = options.workspace) => {
    const result = runner([options.binary, ...args, "--no-pager", "--color", "never"], cwd);
    if (check) exitCode = result.exitCode;
    if (result.exitCode !== 0) {
      throw new RootformCommandError(
        result.exitCode,
        result.stderr.trim() ||
          (args[0] === "validate" ? result.stdout?.trim() : undefined) ||
          `Rootform ${args[0]} exited ${result.exitCode}`,
      );
    }
    for (const path of outputs) {
      if (!existsSync(path) || !lstatSync(path).isFile())
        throw new Error("Rootform exited 0 without every requested output file");
    }
  };
  const compile = (input: string, output: string, planFile?: string) => {
    invoke(
      [
        "run",
        relative(options.workspace, input),
        "--no-serve",
        ...projectFlags(),
        ...pair(planFile),
        "-o",
        output,
      ],
      [output],
    );
    return output;
  };
  const rememberForm = (path: string) => {
    paths.form = path;
    candidates.form = path;
  };

  try {
    const comparing = options.kind === "compare" || Boolean(options.before);
    let form: string;
    if (comparing) {
      if (!options.before || !options.after)
        throw new Error("before and after are required together");
      let before = options.before;
      let after = options.after;
      const beforeSaved = savedFormHint(before);
      const afterSaved = savedFormHint(after);
      // Pairing is per operand. Acquisition flags cannot affect a saved Form.
      // Normalize only when one command cannot represent that exact contract.
      const normalize =
        Boolean(options.beforePlanFile || options.afterPlanFile) ||
        (options.locked && (beforeSaved || afterSaved) && !(beforeSaved && afterSaved));
      if (normalize) {
        if (!beforeSaved)
          before = compile(before, destination("operand-before.json"), options.beforePlanFile);
        else if (options.beforePlanFile) throw new Error("before-plan-file requires a plan export");
        if (!afterSaved)
          after = compile(after, destination("operand-after.json"), options.afterPlanFile);
        else if (options.afterPlanFile) throw new Error("after-plan-file requires a plan export");
      }
      form = destination("form.json");
      candidates.form = form;
      candidates.report = destination("analysis.md");
      candidates.html = destination("explorer.html");
      reports.push(candidates.report);
      invoke(
        [
          "run",
          relative(options.workspace, before),
          "--diff",
          relative(options.workspace, after),
          "--no-serve",
          ...(!normalize && !(beforeSaved && afterSaved) ? projectFlags() : []),
          ...flag("--before-stage", options.beforeStage),
          ...flag("--after-stage", options.afterStage),
          "-o",
          form,
          "-o",
          candidates.report,
          "-o",
          candidates.html,
        ],
        [form, candidates.report, candidates.html],
      );
      rememberForm(form);
    } else {
      if (!options.input) throw new Error("input is required");
      const saved = savedFormHint(options.input);
      const onlyCheck = options.kind === "check";
      form = saved ? options.input : destination("form.json");
      if (onlyCheck && saved) {
        // Validation alone loads no Dialects and recompiles nothing. Only a
        // CLI-validated Form may become an artifact, even for an undecided gate.
        invoke(["validate", "form", form], []);
        rememberForm(form);
      } else if (onlyCheck) {
        candidates.form = form;
        compile(options.input, form, options.planFile);
        rememberForm(form);
      } else {
        candidates.report = destination("analysis.md");
        candidates.html = destination("explorer.html");
        if (!saved) candidates.form = form;
        reports.push(candidates.report);
        invoke(
          [
            "run",
            saved ? basename(options.input) : relative(options.workspace, options.input),
            "--no-serve",
            ...(!saved ? [...projectFlags(), ...pair(options.planFile)] : []),
            ...flag("--stage", options.stage),
            ...(!saved ? ["-o", form] : []),
            "-o",
            candidates.report,
            "-o",
            candidates.html,
          ],
          [...(!saved ? [form] : []), candidates.report, candidates.html],
          false,
          saved ? dirname(options.input) : options.workspace,
        );
        rememberForm(form);
      }
    }
    if (options.kind === "check" || (options.kind === "main" && options.check)) {
      candidates.result = destination("result.json");
      candidates.report = destination("check.md");
      candidates.sarif = destination("results.sarif");
      reports.push(candidates.report);
      invoke(
        [
          "check",
          basename(form),
          ...projectFlags(),
          ...flag("--side", options.side),
          ...flag("--stage", options.stage),
          ...options.policies.flatMap((value) => ["--policy", value]),
          ...options.policyPacks.flatMap((value) => ["--policy-pack", value]),
          "-o",
          candidates.result,
          "-o",
          candidates.report,
          "-o",
          candidates.sarif,
        ],
        [candidates.result, candidates.report, candidates.sarif],
        true,
        dirname(form),
      );
    }
    for (const [name, path] of Object.entries(candidates)) {
      if (path && existsSync(path) && lstatSync(path).isFile()) paths[name as OutputName] = path;
    }
    return { paths, exitCode, reports };
  } catch (failure) {
    // CLI check deliberately writes reports before returning verdict 1/3.
    // Retain every derived file also on a later I/O or command failure.
    for (const [name, path] of Object.entries(candidates)) {
      if (path && existsSync(path) && lstatSync(path).isFile()) paths[name as OutputName] = path;
    }
    return {
      paths,
      exitCode,
      reports,
      failure: failure instanceof Error ? failure : new Error(String(failure)),
    };
  }
}
