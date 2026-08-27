export type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export function run(command: string[], cwd: string, stdin?: Uint8Array | string): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: process.env,
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

export function git(args: string[], cwd: string): CommandResult {
  return run(["git", ...args], cwd);
}

export function repositoryRoot(cwd = process.cwd()): string {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "not inside a Git repository");
  return result.stdout.trim();
}

export function nullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}
