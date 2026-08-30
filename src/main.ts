import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { type Installation, installRootform } from "./install.ts";
import {
  type AnalysisResult,
  type Mode,
  RootformCommandError,
  runAnalysis,
  shouldFail,
} from "./run.ts";

type ArtifactResult = { artifactUrl?: string; id?: number };

export type MainDependencies = {
  artifactClient(): {
    uploadArtifact(name: string, files: string[], rootDirectory: string): Promise<ArtifactResult>;
  };
  core: {
    getBooleanInput(name: string): boolean;
    getInput(name: string): string;
    setFailed(message: string): void;
    setOutput(name: string, value: string): void;
    summary: {
      addRaw(value: string): { write(): Promise<unknown> };
    };
  };
  install(options: { token: string; version: string }): Promise<Installation>;
  run(options: {
    binary: string;
    input: string;
    mode: Mode;
    outputDirectory: string;
    workspace: string;
  }): AnalysisResult;
  workspace(): string;
};

const defaultDependencies: MainDependencies = {
  artifactClient: () => new DefaultArtifactClient(),
  core,
  install: installRootform,
  run: runAnalysis,
  workspace: () => resolve(process.env.GITHUB_WORKSPACE || process.cwd()),
};

function modeInput(actionCore: MainDependencies["core"]): Mode {
  const mode = actionCore.getInput("mode") || "source";
  if (mode !== "source" && mode !== "plan")
    throw new Error(`mode must be source or plan, got ${mode}`);
  return mode;
}

export function containedOutput(workspace: string, input: string): string {
  if (!input || isAbsolute(input)) throw new Error("output-directory must be workspace-relative");
  const output = resolve(workspace, input);
  const prefix = workspace.endsWith(sep) ? workspace : `${workspace}${sep}`;
  if (!output.startsWith(prefix) || output === workspace) {
    throw new Error("output-directory must stay inside workspace");
  }
  let candidate = workspace;
  for (const component of input.split(/[\\/]/u)) {
    if (!component || component === ".") continue;
    candidate = resolve(candidate, component);
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error("output-directory may not traverse a symbolic link");
    }
  }
  if (existsSync(output)) throw new Error("output-directory already exists");
  return output;
}

function relativeOutput(workspace: string, path: string): string {
  return relative(workspace, path).replaceAll("\\", "/");
}

function sanitized(error: unknown, workspace: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const privateRoots = [
    workspace,
    process.env.RUNNER_TEMP,
    process.env.RUNNER_TOOL_CACHE,
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter((value): value is string => Boolean(value));
  return privateRoots.reduce((result, path) => result.replaceAll(path, "<runner-path>"), message);
}

export async function main(dependencies: MainDependencies = defaultDependencies): Promise<void> {
  const actionCore = dependencies.core;
  const workspace = resolve(dependencies.workspace());
  try {
    const installation = await dependencies.install({
      token: actionCore.getInput("github-token"),
      version: actionCore.getInput("version") || "latest",
    });
    actionCore.setOutput("version", installation.version);
    const mode = modeInput(actionCore);
    const input = actionCore.getInput("path") || ".";
    const outputName = actionCore.getInput("output-directory") || "rootform-results";
    const outputDirectory = containedOutput(workspace, outputName);
    const result = dependencies.run({
      binary: installation.binary,
      input,
      mode,
      outputDirectory,
      workspace,
    });

    actionCore.setOutput("exit-code", String(result.exitCode));

    if (result.exitCode === 2 || result.exitCode === 3) {
      actionCore.setFailed(`Rootform check exited ${result.exitCode}`);
      return;
    }

    await actionCore.summary.addRaw(readFileSync(result.paths.markdown, "utf8")).write();
    actionCore.setOutput("architecture", relativeOutput(workspace, result.paths.architecture));
    actionCore.setOutput("html", relativeOutput(workspace, result.paths.html));
    actionCore.setOutput("policy-json", relativeOutput(workspace, result.paths.policyJson));
    actionCore.setOutput("sarif", relativeOutput(workspace, result.paths.sarif));

    if (actionCore.getBooleanInput("upload-artifact")) {
      const name = actionCore.getInput("artifact-name") || "rootform";
      const artifact = await dependencies
        .artifactClient()
        .uploadArtifact(
          name,
          [
            result.paths.architecture,
            result.paths.html,
            result.paths.policyJson,
            result.paths.sarif,
          ],
          outputDirectory,
        );
      if (artifact.id === undefined) throw new Error("artifact upload returned no identifier");
      actionCore.setOutput("artifact-id", String(artifact.id));
      if (artifact.artifactUrl) actionCore.setOutput("artifact-url", artifact.artifactUrl);
    }

    if (shouldFail(result.exitCode, actionCore.getBooleanInput("fail-on-violations"))) {
      actionCore.setFailed(`Rootform check exited ${result.exitCode}`);
    }
  } catch (error) {
    if (error instanceof RootformCommandError) {
      actionCore.setOutput("exit-code", String(error.exitCode));
    }
    actionCore.setFailed(sanitized(error, workspace));
  }
}
