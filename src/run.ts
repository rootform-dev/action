import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Mode = "plan" | "source";

export type ResultPaths = {
  architecture: string;
  html: string;
  markdown: string;
  policyJson: string;
  sarif: string;
};

export type CommandPlan = {
  buildJson: string[];
  buildHtml: string[];
  checkJson: string[];
  checkMarkdown: string[];
  checkSarif: string[];
};

export type AnalysisResult = {
  exitCode: number;
  paths: ResultPaths;
};

export class RootformCommandError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = "RootformCommandError";
    this.exitCode = exitCode;
  }
}

export type CommandRunner = (
  command: string[],
  cwd: string,
) => {
  exitCode: number;
  stderr: string;
};

export function resultPaths(directory: string): ResultPaths {
  return {
    architecture: join(directory, "architecture.json"),
    html: join(directory, "architecture.html"),
    markdown: join(directory, "summary.md"),
    policyJson: join(directory, "policy.json"),
    sarif: join(directory, "policy.sarif"),
  };
}

export function commandPlan(
  binary: string,
  mode: Mode,
  input: string,
  paths: ResultPaths,
): CommandPlan {
  const buildInput = mode === "plan" ? ["--plan", input] : [input];
  const checkInput = mode === "plan" ? ["--plan", input] : [input];
  return {
    buildJson: [binary, "build", ...buildInput, "--format", "json", "--output", paths.architecture],
    buildHtml: [binary, "build", ...buildInput, "--format", "html", "--output", paths.html],
    checkJson: [binary, "check", ...checkInput, "--format", "json", "--output", paths.policyJson],
    checkMarkdown: [
      binary,
      "check",
      ...checkInput,
      "--format",
      "markdown",
      "--output",
      paths.markdown,
    ],
    checkSarif: [binary, "check", ...checkInput, "--format", "sarif", "--output", paths.sarif],
  };
}

function run(command: string[], cwd: string): { exitCode: number; stderr: string } {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Rootform command is empty");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 3,
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export function runAnalysis(options: {
  binary: string;
  input: string;
  mode: Mode;
  outputDirectory: string;
  runner?: CommandRunner;
  workspace: string;
}): AnalysisResult {
  mkdirSync(options.outputDirectory, { recursive: false });
  const paths = resultPaths(options.outputDirectory);
  const plan = commandPlan(options.binary, options.mode, options.input, paths);
  const runner = options.runner ?? run;
  for (const command of [plan.buildJson, plan.buildHtml]) {
    const result = runner(command, options.workspace);
    if (result.exitCode !== 0) {
      throw new RootformCommandError(
        result.exitCode,
        result.stderr || `Rootform build exited ${result.exitCode}`,
      );
    }
  }

  const checkResults = [plan.checkJson, plan.checkSarif, plan.checkMarkdown].map((command) =>
    runner(command, options.workspace),
  );
  const codes = new Set(checkResults.map(({ exitCode }) => exitCode));
  if (codes.size !== 1) throw new Error("Rootform check formats returned different exit codes");
  const exitCode = checkResults[0]?.exitCode ?? 3;
  if (![0, 1, 2, 3].includes(exitCode)) {
    const diagnostic = checkResults.find(({ stderr }) => stderr)?.stderr;
    throw new RootformCommandError(exitCode, diagnostic || `Rootform check exited ${exitCode}`);
  }
  return { exitCode, paths };
}

export function shouldFail(exitCode: number, failOnViolations: boolean): boolean {
  if (exitCode === 0) return false;
  if (exitCode === 1) return failOnViolations;
  return true;
}
