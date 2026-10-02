import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { containedInput } from "./paths.ts";

test("accepts absolute workspace files and reusable Forms under runner temp", () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-path-workspace-"));
  const temporary = mkdtempSync(join(tmpdir(), "rootform-path-temp-"));
  const workspaceFile = join(workspace, "saved.form");
  const temporaryFile = join(temporary, "reused.form");
  writeFileSync(workspaceFile, "opaque workspace file");
  writeFileSync(temporaryFile, "opaque reusable file");

  try {
    expect(containedInput(workspace, workspaceFile, "file", "input", temporary)).toBe(
      realpathSync(workspaceFile),
    );
    expect(containedInput(workspace, temporaryFile, "file", "input", temporary)).toBe(
      realpathSync(temporaryFile),
    );
    expect(containedInput(workspace, workspace, "directory", "project")).toBe(
      realpathSync(workspace),
    );
  } finally {
    rmSync(workspace, { force: true, recursive: true });
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("rejects escaped paths, symlinks, wrong file types and newline input", () => {
  const workspace = mkdtempSync(join(tmpdir(), "rootform-path-workspace-"));
  const temporary = mkdtempSync(join(tmpdir(), "rootform-path-temp-"));
  const outside = mkdtempSync(join(tmpdir(), "rootform-path-outside-"));
  const project = join(workspace, "project");
  const workspaceFile = join(workspace, "saved.form");
  const outsideFile = join(outside, "outside.form");
  const link = join(workspace, "outside-link");
  mkdirSync(project);
  writeFileSync(workspaceFile, "opaque workspace file");
  writeFileSync(outsideFile, "opaque outside file");
  symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");

  try {
    expect(() =>
      containedInput(workspace, relative(workspace, outsideFile), "file", "input", temporary),
    ).toThrow("input must remain inside workspace or runner temporary storage");
    expect(() => containedInput(workspace, link, "directory", "project", temporary)).toThrow(
      "project must remain inside workspace or runner temporary storage",
    );
    expect(() =>
      containedInput(workspace, join(link, "outside.form"), "file", "input", temporary),
    ).toThrow("input must remain inside workspace or runner temporary storage");
    expect(() => containedInput(workspace, project, "file", "input", temporary)).toThrow(
      "input must be a file",
    );
    expect(() => containedInput(workspace, workspaceFile, "directory", "project")).toThrow(
      "project must be a directory",
    );
    expect(() => containedInput(workspace, "saved\n.form", "file", "input", temporary)).toThrow(
      "input requires one file or directory path",
    );
  } finally {
    rmSync(workspace, { force: true, recursive: true });
    rmSync(temporary, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});
