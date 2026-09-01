import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { cliEnvironment } from "./environment.ts";
import { type CommandRunner, RootformCommandError } from "./run.ts";

export type DiffPaths = {
  baselineArchitecture?: string;
  baselineHtml?: string;
  json: string;
  markdown: string;
};

export type PlannedCommand = {
  command: string[];
  cwd: string;
};

export type DiffCommandPlan = {
  baseline: PlannedCommand[];
  comparisons: PlannedCommand[];
};

export type DiffResult = {
  exitCode: number;
  paths: DiffPaths;
};

export function diffPaths(directory: string, includeBaseline: boolean): DiffPaths {
  return {
    ...(includeBaseline
      ? {
          baselineArchitecture: join(directory, "baseline-architecture.json"),
          baselineHtml: join(directory, "baseline-architecture.html"),
        }
      : {}),
    json: join(directory, "architecture-diff.json"),
    markdown: join(directory, "architecture-diff.md"),
  };
}

export function diffCommandPlan(options: {
  baselineWorkspace?: string;
  binary: string;
  currentArchitecture: string;
  input: string;
  mode: "plan" | "source";
  outputDirectory: string;
  workspace: string;
}): DiffCommandPlan {
  const paths = diffPaths(options.outputDirectory, options.mode === "source");
  if (options.mode === "source") {
    if (!options.baselineWorkspace || !paths.baselineArchitecture || !paths.baselineHtml) {
      throw new Error("source diff requires a baseline project");
    }
    return {
      baseline: [
        {
          command: [
            options.binary,
            "build",
            ".",
            "--format",
            "json",
            "--output",
            paths.baselineArchitecture,
          ],
          cwd: options.baselineWorkspace,
        },
        {
          command: [
            options.binary,
            "build",
            ".",
            "--format",
            "html",
            "--output",
            paths.baselineHtml,
          ],
          cwd: options.baselineWorkspace,
        },
      ],
      comparisons: [
        {
          command: [
            options.binary,
            "diff",
            paths.baselineArchitecture,
            options.currentArchitecture,
            "--format",
            "json",
            "--output",
            paths.json,
            "--exit-code",
          ],
          cwd: options.workspace,
        },
        {
          command: [
            options.binary,
            "diff",
            paths.baselineArchitecture,
            options.currentArchitecture,
            "--format",
            "markdown",
            "--output",
            paths.markdown,
            "--exit-code",
          ],
          cwd: options.workspace,
        },
      ],
    };
  }

  return {
    baseline: [],
    comparisons: [
      {
        command: [
          options.binary,
          "diff",
          "--plan",
          options.input,
          "--format",
          "json",
          "--output",
          paths.json,
          "--exit-code",
        ],
        cwd: options.workspace,
      },
      {
        command: [
          options.binary,
          "diff",
          "--plan",
          options.input,
          "--format",
          "markdown",
          "--output",
          paths.markdown,
          "--exit-code",
        ],
        cwd: options.workspace,
      },
    ],
  };
}

function run(command: string[], cwd: string): { exitCode: number; stderr: string } {
  const [executable, ...args] = command;
  if (!executable) throw new Error("Rootform command is empty");
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: cliEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 3,
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export function runDiff(options: {
  baselineWorkspace?: string;
  binary: string;
  currentArchitecture: string;
  input: string;
  mode: "plan" | "source";
  outputDirectory: string;
  runner?: CommandRunner;
  workspace: string;
}): DiffResult {
  const paths = diffPaths(options.outputDirectory, options.mode === "source");
  const plan = diffCommandPlan(options);
  const runner = options.runner ?? run;

  for (const planned of plan.baseline) {
    const result = runner(planned.command, planned.cwd);
    if (result.exitCode !== 0) {
      throw new RootformCommandError(
        result.exitCode,
        result.stderr || `Rootform build exited ${result.exitCode}`,
      );
    }
  }

  const results = plan.comparisons.map((planned) => runner(planned.command, planned.cwd));
  const codes = new Set(results.map(({ exitCode }) => exitCode));
  if (codes.size !== 1) throw new Error("Rootform diff formats returned different exit codes");
  const exitCode = results[0]?.exitCode ?? 3;
  if (exitCode !== 0 && exitCode !== 1) {
    const diagnostic = results.find(({ stderr }) => stderr)?.stderr;
    throw new RootformCommandError(exitCode, diagnostic || `Rootform diff exited ${exitCode}`);
  }
  return { exitCode, paths };
}
