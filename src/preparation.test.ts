import { expect, test } from "bun:test";
import { runPreparation } from "./preparation.ts";
import { RootformCommandError } from "./run.ts";

test("maps locked and offline modes to one non-interactive init call", () => {
  const modes = [
    { locked: false, offline: false, flags: [] },
    { locked: true, offline: false, flags: ["--locked"] },
    { locked: false, offline: true, flags: ["--offline"] },
    { locked: true, offline: true, flags: ["--locked", "--offline"] },
  ];

  for (const mode of modes) {
    const calls: Array<{ command: string[]; cwd: string }> = [];
    const result = runPreparation({
      binary: "/runner/tool-cache/rootform",
      project: "/workspace/project",
      workspace: "/workspace",
      locked: mode.locked,
      offline: mode.offline,
      runner: (command, cwd) => {
        calls.push({ command, cwd });
        return { exitCode: 0, stderr: "" };
      },
    });

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: [
        "/runner/tool-cache/rootform",
        "init",
        "/workspace/project",
        "--format",
        "json",
        "--no-input",
        ...mode.flags,
        "--no-pager",
        "--color",
        "never",
      ],
      cwd: "/workspace",
    });
  }
});

test("a nonzero init exit fails after that single call without fallback", () => {
  const calls: string[][] = [];
  let observed: unknown;

  try {
    runPreparation({
      binary: "rootform",
      project: ".",
      workspace: "/workspace",
      locked: true,
      offline: true,
      runner: (command) => {
        calls.push(command);
        return { exitCode: 4, stderr: "locked selection is unavailable\n" };
      },
    });
  } catch (error) {
    observed = error;
  }

  expect(observed).toBeInstanceOf(RootformCommandError);
  expect(observed).toMatchObject({
    exitCode: 4,
    message: "locked selection is unavailable",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe("init");
});
