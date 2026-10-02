import { type CommandRunner, RootformCommandError, runCommand } from "./run.ts";

export type PreparationOptions = { locked: boolean; offline: boolean };
export function preparationCommand(
  binary: string,
  project: string,
  options: PreparationOptions,
): string[] {
  return [
    binary,
    "init",
    project,
    "--format",
    "json",
    "--no-input",
    ...(options.locked ? ["--locked"] : []),
    ...(options.offline ? ["--offline"] : []),
    "--no-pager",
    "--color",
    "never",
  ];
}
export function runPreparation(
  options: PreparationOptions & {
    binary: string;
    project: string;
    workspace: string;
    runner?: CommandRunner;
  },
): void {
  const result = (options.runner ?? runCommand)(
    preparationCommand(options.binary, options.project, options),
    options.workspace,
  );
  if (result.exitCode !== 0)
    throw new RootformCommandError(
      result.exitCode,
      result.stderr.trim() || `Rootform init exited ${result.exitCode}`,
    );
}
