import { describe, expect, test } from "bun:test";
import {
  preparationCommand,
  preparationMode,
  readPreparation,
  runPreparation,
} from "./preparation.ts";
import { RootformCommandError } from "./run.ts";

const envelope = {
  downloaded_bytes: 128,
  dialects: [
    {
      kind: "dialect",
      name: "acme",
      source:
        "registry.example/acme/rootform@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "acquired",
      version: "0.1.0",
    },
  ],
  format_version: "1",
  policy_packs: [
    {
      kind: "policy-pack",
      name: "baseline",
      source: "local:policies/baseline",
      status: "verified",
      version: "0.1.0",
    },
  ],
  prepared: true,
} as const;

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
    expect(preparation.dialects).toEqual([...envelope.dialects]);
    expect(preparation.policyPacks).toEqual([...envelope.policy_packs]);
    expect(preparation.downloadedBytes).toBe(128);
    expect(preparation.preparationMode).toBe("default");
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
    expect(preparationMode({ locked: false, offline: false })).toBe("default");
    expect(preparationMode({ locked: true, offline: false })).toBe("locked");
    expect(preparationMode({ locked: false, offline: true })).toBe("offline");
    expect(preparationMode({ locked: true, offline: true })).toBe("locked-offline");
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
          stderr: "rootform: dialect acme@0.1.0 is unavailable\n",
          stdout: "",
        }),
        workspace: "/workspace",
      }),
    ).toThrow("rootform: dialect acme@0.1.0 is unavailable");

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

  test("reports exact prepared external units without reinterpreting them", () => {
    const preparation = runPreparation({
      binary: "rootform",
      input: ".",
      locked: false,
      offline: false,
      runner: () => ({
        exitCode: 0,
        stderr: "",
        stdout: envelopeText(),
      }),
      workspace: "/workspace",
    });
    expect(preparation.dialects).toEqual([...envelope.dialects]);
    expect(preparation.policyPacks).toEqual([...envelope.policy_packs]);
    expect(preparation.downloadedBytes).toBe(128);
  });

  test("rejects an envelope the CLI did not produce", () => {
    expect(() => readPreparation("not json", "default")).toThrow(
      "Rootform initialization returned no machine envelope",
    );
    expect(() => readPreparation("[]", "default")).toThrow(
      "Rootform initialization envelope must be an object",
    );
    expect(() => readPreparation(JSON.stringify({ prepared: true }), "default")).toThrow(
      "Rootform initialization envelope has unsupported format version",
    );
    expect(() => readPreparation(envelopeText({ prepared: false }), "default")).toThrow(
      "Rootform initialization did not prepare the selection",
    );
    expect(() => readPreparation(envelopeText({ providers_detected: 1 }), "default")).toThrow(
      "Rootform initialization envelope has unknown fields",
    );
    expect(() => readPreparation(envelopeText({ extensions: [] }), "default")).toThrow(
      "Rootform initialization envelope has unknown fields",
    );
    expect(() =>
      readPreparation(envelopeText({ dialects: [{ name: "acme" }] }), "default"),
    ).toThrow("Rootform initialization dialects are invalid");
    expect(() =>
      readPreparation(
        envelopeText({
          dialects: [{ ...envelope.dialects[0], legacy: true }],
        }),
        "default",
      ),
    ).toThrow("Rootform initialization dialects are invalid");
    expect(() =>
      readPreparation(
        envelopeText({
          policy_packs: [
            {
              kind: "policy-pack",
              name: "baseline",
              source: "local:baseline",
              status: "unknown",
              version: "0.1.0",
            },
          ],
        }),
        "default",
      ),
    ).toThrow("Rootform initialization Policy Packs are invalid");
    expect(() => readPreparation(envelopeText({ downloaded_bytes: -1 }), "default")).toThrow(
      "Rootform initialization downloaded byte count is invalid",
    );
    expect(() =>
      readPreparation(
        envelopeText({ dialects: [envelope.dialects[0], envelope.dialects[0]] }),
        "default",
      ),
    ).toThrow("Rootform initialization dialects are not canonical");
    expect(
      readPreparation(envelopeText({ dialects: undefined, policy_packs: undefined }), "default"),
    ).toMatchObject({
      downloadedBytes: 128,
      dialects: [],
      policyPacks: [],
    });
  });
});
