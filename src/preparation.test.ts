import { describe, expect, test } from "bun:test";
import {
  preparationCommand,
  readPreparation,
  resolutionMode,
  runPreparation,
} from "./preparation.ts";
import { RootformCommandError } from "./run.ts";

const envelope = {
  dialects: [
    { name: "aws", version: "0.1.0" },
    { name: "core", version: "0.1.0" },
  ],
  download_size: 0,
  format_version: "1",
  incompatible_providers: [],
  lock_written: false,
  providers_detected: 1,
  unsupported_providers: [],
  warnings: [],
};

function envelopeText(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ ...envelope, ...overrides }, null, 2)}\n`;
}

describe("project preparation", () => {
  test("builds one exact preparation command", () => {
    const commands: Array<{ command: string[]; cwd: string }> = [];
    const preparation = runPreparation({
      binary: "/tool-cache/rootform",
      input: ".",
      locked: false,
      offline: false,
      runner: (command, cwd) => {
        commands.push({ command, cwd });
        return { exitCode: 0, stderr: "", stdout: envelopeText() };
      },
      workspace: "/workspace/project",
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toEqual([
      "/tool-cache/rootform",
      "init",
      ".",
      "--format",
      "json",
      "--no-input",
    ]);
    expect(commands[0]?.cwd).toBe("/workspace/project");
    expect(preparation.dialects).toEqual([
      { name: "aws", version: "0.1.0" },
      { name: "core", version: "0.1.0" },
    ]);
    expect(preparation.providersDetected).toBe(1);
    expect(preparation.lockWritten).toBeFalse();
    expect(preparation.resolutionMode).toBe("default");
  });

  test("maps execution modes to CLI flags", () => {
    expect(preparationCommand("rootform", ".", { locked: true, offline: false })).toEqual([
      "rootform",
      "init",
      ".",
      "--format",
      "json",
      "--no-input",
      "--locked",
    ]);
    expect(preparationCommand("rootform", ".", { locked: false, offline: true })).toEqual([
      "rootform",
      "init",
      ".",
      "--format",
      "json",
      "--no-input",
      "--offline",
    ]);
    expect(preparationCommand("rootform", ".", { locked: true, offline: true })).toEqual([
      "rootform",
      "init",
      ".",
      "--format",
      "json",
      "--no-input",
      "--locked",
      "--offline",
    ]);
    // No mode may drop --no-input: a runner must never wait for a prompt.
    for (const locked of [false, true]) {
      for (const offline of [false, true]) {
        expect(preparationCommand("rootform", ".", { locked, offline })).toContain("--no-input");
        expect(preparationCommand("rootform", ".", { locked, offline })).not.toContain("--upgrade");
      }
    }
    expect(resolutionMode({ locked: false, offline: false })).toBe("default");
    expect(resolutionMode({ locked: true, offline: false })).toBe("locked");
    expect(resolutionMode({ locked: false, offline: true })).toBe("offline");
    expect(resolutionMode({ locked: true, offline: true })).toBe("locked-offline");
  });

  test("stops on a failed preparation", () => {
    expect(() =>
      runPreparation({
        binary: "rootform",
        input: ".",
        locked: true,
        offline: false,
        runner: () => ({
          exitCode: 1,
          stderr: "rootform: rootform.lock does not cover provider aws\n",
          stdout: "",
        }),
        workspace: "/workspace",
      }),
    ).toThrow("rootform: rootform.lock does not cover provider aws");

    try {
      runPreparation({
        binary: "rootform",
        input: ".",
        locked: false,
        offline: true,
        runner: () => ({ exitCode: 3, stderr: "", stdout: "" }),
        workspace: "/workspace",
      });
      throw new Error("preparation must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RootformCommandError);
      expect((error as RootformCommandError).exitCode).toBe(3);
      expect((error as RootformCommandError).message).toBe("Rootform init exited 3");
    }
  });

  test("reports a generated lock and CLI warnings without reinterpreting them", () => {
    const preparation = runPreparation({
      binary: "rootform",
      input: ".",
      locked: false,
      offline: false,
      runner: () => ({
        exitCode: 0,
        stderr: "rootform: warning: provider version compatibility is unverified\n",
        stdout: envelopeText({
          lock_written: true,
          unsupported_providers: ["registry.terraform.io/vancluever/acme"],
          warnings: ["provider version compatibility is unverified"],
        }),
      }),
      workspace: "/workspace",
    });
    expect(preparation.lockWritten).toBeTrue();
    expect(preparation.unsupportedProviders).toEqual(["registry.terraform.io/vancluever/acme"]);
    expect(preparation.warnings).toEqual(["provider version compatibility is unverified"]);
  });

  test("rejects an envelope the CLI did not produce", () => {
    expect(() => readPreparation("not json", "default")).toThrow(
      "Rootform initialization returned no machine envelope",
    );
    expect(() => readPreparation("[]", "default")).toThrow(
      "Rootform initialization envelope must be an object",
    );
    expect(() => readPreparation(JSON.stringify({ dialects: [] }), "default")).toThrow(
      "Rootform initialization envelope has no format version",
    );
    expect(() => readPreparation(envelopeText({ dialects: [{ name: "aws" }] }), "default")).toThrow(
      "Rootform initialization dialects are invalid",
    );
    expect(() => readPreparation(envelopeText({ lock_written: "yes" }), "default")).toThrow(
      "Rootform initialization lock state is invalid",
    );
    expect(() => readPreparation(envelopeText({ warnings: [1] }), "default")).toThrow(
      "Rootform initialization warnings is invalid",
    );
  });
});
