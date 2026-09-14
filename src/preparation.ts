import { spawnSync } from "node:child_process";
import { cliEnvironment } from "./environment.ts";
import { RootformCommandError } from "./run.ts";

export type PreparationMode = "default" | "locked" | "locked-offline" | "offline";

export type PreparationOptions = {
  locked: boolean;
  offline: boolean;
};

export type PreparedUnit = {
  kind: "dialect" | "policy-pack";
  name: string;
  source: string;
  status: "acquired" | "verified";
  version: string;
};

export type Preparation = {
  downloadedBytes: number;
  dialects: PreparedUnit[];
  policyPacks: PreparedUnit[];
  preparationMode: PreparationMode;
};

export type PreparationRunner = (
  command: string[],
  cwd: string,
) => {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export function preparationMode(options: PreparationOptions): PreparationMode {
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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function preparedUnits(value: unknown, kind: PreparedUnit["kind"], field: string): PreparedUnit[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4096) {
    throw new Error(`Rootform initialization ${field} are invalid`);
  }
  const units = value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Rootform initialization ${field} are invalid`);
    }
    const record = entry as Record<string, unknown>;
    const status = record.status;
    if (
      !hasExactKeys(record, ["kind", "name", "source", "status", "version"]) ||
      record.kind !== kind ||
      typeof record.name !== "string" ||
      record.name.length > 64 ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(record.name) ||
      typeof record.version !== "string" ||
      !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(record.version) ||
      typeof record.source !== "string" ||
      record.source.length === 0 ||
      Buffer.byteLength(record.source, "utf8") > 4096 ||
      /[\r\n\0]/u.test(record.source) ||
      (status !== "verified" && status !== "acquired")
    ) {
      throw new Error(`Rootform initialization ${field} are invalid`);
    }
    return {
      kind,
      name: record.name,
      source: record.source,
      status: status as PreparedUnit["status"],
      version: record.version,
    };
  });
  for (let index = 1; index < units.length; index += 1) {
    const previous = units[index - 1];
    const current = units[index];
    if (!previous || !current || previous.name >= current.name) {
      throw new Error(`Rootform initialization ${field} are not canonical`);
    }
  }
  return units;
}

/**
 * Reads the CLI envelope. Only the fields the Action presents or exposes are
 * consumed: no Rootform decision is recomputed from this document.
 */
export function readPreparation(stdout: string, mode: PreparationMode): Preparation {
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
  const keys = Object.keys(envelope);
  if (
    keys.some(
      (key) =>
        !["dialects", "downloaded_bytes", "format_version", "policy_packs", "prepared"].includes(
          key,
        ),
    )
  ) {
    throw new Error("Rootform initialization envelope has unknown fields");
  }
  if (envelope.format_version !== "1") {
    throw new Error("Rootform initialization envelope has unsupported format version");
  }
  if (envelope.prepared !== true) {
    throw new Error("Rootform initialization did not prepare the selection");
  }
  const downloadedBytes = envelope.downloaded_bytes ?? 0;
  if (!Number.isSafeInteger(downloadedBytes) || Number(downloadedBytes) < 0) {
    throw new Error("Rootform initialization downloaded byte count is invalid");
  }
  return {
    downloadedBytes: Number(downloadedBytes),
    dialects: preparedUnits(envelope.dialects, "dialect", "dialects"),
    policyPacks: preparedUnits(envelope.policy_packs, "policy-pack", "Policy Packs"),
    preparationMode: mode,
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
  const mode = preparationMode(options);
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
