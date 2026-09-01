import { spawnSync } from "node:child_process";
import { cliEnvironment } from "./environment.ts";
import { RootformCommandError } from "./run.ts";

export type ResolutionMode = "default" | "locked" | "locked-offline" | "offline";

export type PreparationOptions = {
  locked: boolean;
  offline: boolean;
};

export type PreparedDialect = {
  name: string;
  version: string;
};

export type Preparation = {
  dialects: PreparedDialect[];
  lockWritten: boolean;
  providersDetected: number;
  resolutionMode: ResolutionMode;
  unsupportedProviders: string[];
  warnings: string[];
};

export type PreparationRunner = (
  command: string[],
  cwd: string,
) => {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export function resolutionMode(options: PreparationOptions): ResolutionMode {
  if (options.locked && options.offline) return "locked-offline";
  if (options.locked) return "locked";
  if (options.offline) return "offline";
  return "default";
}

/**
 * Builds the single initialization command a run performs before analysis.
 * Execution modes map to the CLI's own flags: the Action never invents a
 * preparation grammar of its own. `--no-input` is always present so a runner
 * can never block on a prompt, independently of CI environment detection.
 */
export function preparationCommand(
  binary: string,
  input: string,
  options: PreparationOptions,
): string[] {
  return [
    binary,
    "init",
    input,
    "--format",
    "json",
    "--no-input",
    ...(options.locked ? ["--locked"] : []),
    ...(options.offline ? ["--offline"] : []),
  ];
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Rootform initialization ${field} is invalid`);
  }
  return value as string[];
}

/**
 * Reads the CLI envelope. Only the fields the Action presents or exposes are
 * consumed: no Rootform decision is recomputed from this document.
 */
export function readPreparation(stdout: string, mode: ResolutionMode): Preparation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Rootform initialization returned no machine envelope");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Rootform initialization envelope must be an object");
  }
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.format_version !== "string") {
    throw new Error("Rootform initialization envelope has no format version");
  }
  if (!Array.isArray(envelope.dialects)) {
    throw new Error("Rootform initialization dialects are invalid");
  }
  const dialects = envelope.dialects.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Rootform initialization dialects are invalid");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.version !== "string") {
      throw new Error("Rootform initialization dialects are invalid");
    }
    return { name: record.name, version: record.version };
  });
  if (typeof envelope.lock_written !== "boolean") {
    throw new Error("Rootform initialization lock state is invalid");
  }
  if (!Number.isSafeInteger(envelope.providers_detected)) {
    throw new Error("Rootform initialization provider count is invalid");
  }
  return {
    dialects,
    lockWritten: envelope.lock_written,
    providersDetected: Number(envelope.providers_detected),
    resolutionMode: mode,
    unsupportedProviders: stringList(envelope.unsupported_providers, "unsupported providers"),
    warnings: stringList(envelope.warnings, "warnings"),
  };
}

function run(command: string[], cwd: string): { exitCode: number; stderr: string; stdout: string } {
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
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

/**
 * Prepares the project once. A non-zero exit stops the job with the CLI's own
 * diagnostic: the Action never retries with different flags, never falls back
 * to a weaker mode, and never edits the project lock itself.
 */
export function runPreparation(options: {
  binary: string;
  input: string;
  locked: boolean;
  offline: boolean;
  runner?: PreparationRunner;
  workspace: string;
}): Preparation {
  const mode = resolutionMode(options);
  const command = preparationCommand(options.binary, options.input, options);
  const result = (options.runner ?? run)(command, options.workspace);
  if (result.exitCode !== 0) {
    throw new RootformCommandError(
      result.exitCode,
      result.stderr.trim() || `Rootform init exited ${result.exitCode}`,
    );
  }
  return readPreparation(result.stdout, mode);
}
