import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { type DiffResult, runDiff } from "./diff.ts";
import { type Installation, installRootform } from "./install.ts";
import {
  type CommentResult,
  type GitHubContext,
  readGitHubContext,
  upsertPullRequestComment,
} from "./pull-request.ts";
import { type ReportOptions, renderReport } from "./report.ts";
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
  comment?(options: {
    body: string;
    identity: NonNullable<GitHubContext["pullRequest"]>;
    token: string;
  }): Promise<CommentResult>;
  context?(): GitHubContext;
  core: {
    getBooleanInput(name: string): boolean;
    getInput(name: string): string;
    notice?(message: string): void;
    setFailed(message: string): void;
    setOutput(name: string, value: string): void;
    setSecret?(value: string): void;
    summary: {
      addRaw(value: string): { write(): Promise<unknown> };
    };
    warning?(message: string): void;
  };
  diff?(options: {
    baselineWorkspace?: string;
    binary: string;
    currentArchitecture: string;
    input: string;
    mode: Mode;
    outputDirectory: string;
    workspace: string;
  }): DiffResult;
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
  comment: upsertPullRequestComment,
  context: readGitHubContext,
  core,
  diff: runDiff,
  install: installRootform,
  run: runAnalysis,
  workspace: () => resolve(process.env.GITHUB_WORKSPACE || process.cwd()),
};

function modeInput(actionCore: MainDependencies["core"]): Mode {
  const mode = actionCore.getInput("mode") || "source";
  if (mode !== "source" && mode !== "plan") {
    throw new Error(`mode must be source or plan, got ${mode}`);
  }
  return mode;
}

function inside(workspace: string, path: string): boolean {
  const prefix = workspace.endsWith(sep) ? workspace : `${workspace}${sep}`;
  return path === workspace || path.startsWith(prefix);
}

function rejectSymlinkTraversal(workspace: string, input: string, label: string): void {
  let candidate = workspace;
  for (const component of input.split(/[\\/]/u)) {
    if (!component || component === ".") continue;
    candidate = resolve(candidate, component);
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${label} may not traverse a symbolic link`);
    }
  }
}

export function containedInput(
  workspace: string,
  input: string,
  kind: "directory" | "file",
  label = "path",
): string {
  if (!input || isAbsolute(input)) throw new Error(`${label} must be workspace-relative`);
  const resolved = resolve(workspace, input);
  if (!inside(workspace, resolved)) throw new Error(`${label} must stay inside workspace`);
  rejectSymlinkTraversal(workspace, input, label);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist`);
  const stat = lstatSync(resolved);
  if (kind === "directory" && !stat.isDirectory()) throw new Error(`${label} must be a directory`);
  if (kind === "file" && !stat.isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}

export function containedOutput(workspace: string, input: string): string {
  if (!input || isAbsolute(input)) throw new Error("output-directory must be workspace-relative");
  const output = resolve(workspace, input);
  if (!inside(workspace, output) || output === workspace) {
    throw new Error("output-directory must stay inside workspace");
  }
  rejectSymlinkTraversal(workspace, input, "output-directory");
  if (existsSync(output)) throw new Error("output-directory already exists");
  return output;
}

function relativeOutput(workspace: string, path: string): string {
  const output = relative(workspace, path).replaceAll("\\", "/");
  return output || ".";
}

function sanitized(error: unknown, workspace: string, secrets: string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const masked = [...new Set(secrets)]
    .sort((left, right) => right.length - left.length)
    .reduce((result, value) => result.replaceAll(value, "***"), message);
  const privateRoots = [
    workspace,
    process.env.RUNNER_TEMP,
    process.env.RUNNER_TOOL_CACHE,
    process.env.HOME,
    process.env.USERPROFILE,
  ].filter((value): value is string => Boolean(value));
  return privateRoots.reduce((result, value) => result.replaceAll(value, "<runner-path>"), masked);
}

function annotation(
  actionCore: MainDependencies["core"],
  diffExitCode: number | undefined,
  policyExitCode: number,
): void {
  const changed = diffExitCode === 1;
  const violations = policyExitCode === 1;
  if (changed || violations) {
    const message =
      changed && violations
        ? "Rootform detected architecture changes and policy violations."
        : changed
          ? "Rootform detected architecture changes."
          : "Rootform detected policy violations.";
    actionCore.warning?.(message);
    return;
  }
  actionCore.notice?.(
    diffExitCode === undefined
      ? "Rootform policy checks passed."
      : "Rootform architecture is unchanged and policy checks passed.",
  );
}

function reportOptions(options: {
  artifactUrl?: string;
  baselinePath?: string;
  commentState?: string;
  context: GitHubContext;
  currentPath: string;
  diffResult?: DiffResult;
  mode: Mode;
  policyExitCode: number;
  policyMarkdown: string;
  version: string;
}): ReportOptions {
  return {
    artifactUrl: options.artifactUrl,
    baseSha: options.context.pullRequest?.baseSha,
    baselinePath: options.baselinePath,
    commentState: options.commentState,
    currentPath: options.currentPath,
    diffExitCode: options.diffResult?.exitCode,
    diffMarkdown: options.diffResult
      ? readFileSync(options.diffResult.paths.markdown, "utf8")
      : undefined,
    headSha: options.context.pullRequest?.headSha,
    mode: options.mode,
    policyExitCode: options.policyExitCode,
    policyMarkdown: options.policyMarkdown,
    version: options.version,
    workflowUrl: options.context.workflowUrl,
  };
}

export async function main(dependencies: MainDependencies = defaultDependencies): Promise<void> {
  const actionCore = dependencies.core;
  const workspace = resolve(dependencies.workspace());
  const releaseToken = actionCore.getInput("github-token");
  const pullRequestToken = actionCore.getInput("pull-request-token");
  const secrets = [releaseToken, pullRequestToken].filter(Boolean);
  for (const secret of secrets) actionCore.setSecret?.(secret);
  let commandOutput: "diff-exit-code" | "exit-code" | undefined;

  try {
    const installation = await dependencies.install({
      token: releaseToken,
      version: actionCore.getInput("version") || "latest",
    });
    actionCore.setOutput("version", installation.version);

    const mode = modeInput(actionCore);
    const input = actionCore.getInput("path") || ".";
    const inputPath = containedInput(workspace, input, mode === "source" ? "directory" : "file");
    const analysisWorkspace = mode === "source" ? inputPath : workspace;
    const analysisInput = mode === "source" ? "." : relativeOutput(workspace, inputPath);
    const currentPath = relativeOutput(workspace, inputPath);
    const outputName = actionCore.getInput("output-directory") || "rootform-results";
    const outputDirectory = containedOutput(workspace, outputName);

    commandOutput = "exit-code";
    const result = dependencies.run({
      binary: installation.binary,
      input: analysisInput,
      mode,
      outputDirectory,
      workspace: analysisWorkspace,
    });
    commandOutput = undefined;
    actionCore.setOutput("exit-code", String(result.exitCode));

    if (result.exitCode === 2 || result.exitCode === 3) {
      actionCore.setFailed(`Rootform check exited ${result.exitCode}`);
      return;
    }

    const reportDiff = actionCore.getBooleanInput("report-diff");
    let baselinePath: string | undefined;
    let baselineWorkspace: string | undefined;
    let diffResult: DiffResult | undefined;
    if (reportDiff) {
      if (mode === "source") {
        const baselineInput = actionCore.getInput("baseline-path");
        if (!baselineInput) throw new Error("baseline-path is required for source diff reporting");
        baselineWorkspace = containedInput(workspace, baselineInput, "directory", "baseline-path");
        baselinePath = relativeOutput(workspace, baselineWorkspace);
      }
      commandOutput = "diff-exit-code";
      diffResult = (dependencies.diff ?? runDiff)({
        baselineWorkspace,
        binary: installation.binary,
        currentArchitecture: result.paths.architecture,
        input: analysisInput,
        mode,
        outputDirectory,
        workspace: analysisWorkspace,
      });
      commandOutput = undefined;
      actionCore.setOutput("diff-exit-code", String(diffResult.exitCode));
      actionCore.setOutput("diff-json", relativeOutput(workspace, diffResult.paths.json));
      actionCore.setOutput("diff-markdown", relativeOutput(workspace, diffResult.paths.markdown));
      if (diffResult.paths.baselineArchitecture) {
        actionCore.setOutput(
          "baseline-architecture",
          relativeOutput(workspace, diffResult.paths.baselineArchitecture),
        );
      }
      if (diffResult.paths.baselineHtml) {
        actionCore.setOutput(
          "baseline-html",
          relativeOutput(workspace, diffResult.paths.baselineHtml),
        );
      }
    }

    actionCore.setOutput("architecture", relativeOutput(workspace, result.paths.architecture));
    actionCore.setOutput("html", relativeOutput(workspace, result.paths.html));
    actionCore.setOutput("policy-json", relativeOutput(workspace, result.paths.policyJson));
    actionCore.setOutput("sarif", relativeOutput(workspace, result.paths.sarif));

    let artifactUrl: string | undefined;
    if (actionCore.getBooleanInput("upload-artifact")) {
      const name = actionCore.getInput("artifact-name") || "rootform";
      const files = [
        result.paths.architecture,
        result.paths.html,
        result.paths.policyJson,
        result.paths.sarif,
        ...(diffResult?.paths.baselineArchitecture ? [diffResult.paths.baselineArchitecture] : []),
        ...(diffResult?.paths.baselineHtml ? [diffResult.paths.baselineHtml] : []),
        ...(diffResult ? [diffResult.paths.json, diffResult.paths.markdown] : []),
      ];
      const artifact = await dependencies
        .artifactClient()
        .uploadArtifact(name, files, outputDirectory);
      if (artifact.id === undefined) throw new Error("artifact upload returned no identifier");
      actionCore.setOutput("artifact-id", String(artifact.id));
      if (artifact.artifactUrl) {
        artifactUrl = artifact.artifactUrl;
        actionCore.setOutput("artifact-url", artifact.artifactUrl);
      }
    }

    const policyMarkdown = readFileSync(result.paths.markdown, "utf8");
    const reportingEnabled = reportDiff || Boolean(pullRequestToken);
    if (reportingEnabled) {
      const githubContext = (dependencies.context ?? readGitHubContext)();
      const shared = {
        artifactUrl,
        baselinePath,
        context: githubContext,
        currentPath,
        diffResult,
        mode,
        policyExitCode: result.exitCode,
        policyMarkdown,
        version: installation.version,
      };
      let commentState: string;
      if (!githubContext.pullRequest) {
        commentState = "Skipped — workflow event is not `pull_request`";
      } else if (!githubContext.pullRequest.sameRepository) {
        commentState = "Skipped — fork pull request";
      } else if (!pullRequestToken) {
        commentState = "Not requested";
      } else {
        try {
          const comment = await (dependencies.comment ?? upsertPullRequestComment)({
            body: renderReport(reportOptions(shared), "comment"),
            identity: githubContext.pullRequest,
            token: pullRequestToken,
          });
          const action = comment.action === "created" ? "Created" : "Updated";
          commentState = `${action} — [open comment](${comment.htmlUrl})`;
        } catch (error) {
          commentState = "Failed — see workflow log";
          await actionCore.summary
            .addRaw(renderReport(reportOptions({ ...shared, commentState }), "summary"))
            .write();
          throw error;
        }
      }
      await actionCore.summary
        .addRaw(renderReport(reportOptions({ ...shared, commentState }), "summary"))
        .write();
      annotation(actionCore, diffResult?.exitCode, result.exitCode);
    } else {
      await actionCore.summary.addRaw(policyMarkdown).write();
    }

    const policyFailure = shouldFail(
      result.exitCode,
      actionCore.getBooleanInput("fail-on-violations"),
    );
    const diffFailure = diffResult?.exitCode === 1 && actionCore.getBooleanInput("fail-on-changes");
    if (policyFailure && diffFailure) {
      actionCore.setFailed("Rootform diff exited 1 and Rootform check exited 1");
    } else if (diffFailure) {
      actionCore.setFailed("Rootform diff exited 1");
    } else if (policyFailure) {
      actionCore.setFailed(`Rootform check exited ${result.exitCode}`);
    }
  } catch (error) {
    if (error instanceof RootformCommandError && commandOutput) {
      actionCore.setOutput(commandOutput, String(error.exitCode));
    }
    actionCore.setFailed(sanitized(error, workspace, secrets));
  }
}
