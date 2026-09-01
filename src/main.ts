import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { type CacheClient, cacheKeys, restoreDialectCache, saveDialectCache } from "./cache.ts";
import { type DiffResult, runDiff } from "./diff.ts";
import { type Installation, installRootform } from "./install.ts";
import { type Preparation, runPreparation } from "./preparation.ts";
import {
  type CommentResult,
  type GitHubContext,
  readGitHubContext,
  readWorkflowUrl,
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

export const LOCK_FILE = "rootform.lock";

export const GENERATED_LOCK_NOTICE =
  "Rootform generated rootform.lock for this run. Commit this file to make future analyses reproducible.";

export type MainDependencies = {
  artifactClient(): {
    uploadArtifact(name: string, files: string[], rootDirectory: string): Promise<ArtifactResult>;
  };
  cacheClient?(): CacheClient;
  comment?(options: {
    body: string;
    identity: NonNullable<GitHubContext["pullRequest"]>;
    token: string;
  }): Promise<CommentResult>;
  context?(): GitHubContext;
  core: {
    exportVariable?(name: string, value: string): void;
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
  home?(): string;
  install(options: { token: string; version: string }): Promise<Installation>;
  prepare?(options: {
    binary: string;
    input: string;
    locked: boolean;
    offline: boolean;
    workspace: string;
  }): Preparation;
  run(options: {
    binary: string;
    input: string;
    mode: Mode;
    outputDirectory: string;
    workspace: string;
  }): AnalysisResult;
  workspace(): string;
  workflowUrl?(): string | undefined;
};

/* The Rootform home is a runner path. It is isolated per job so one workflow
   can never observe another's dialect store, and it is exported for later
   steps instead of being published: constitution VII keeps absolute runner
   paths out of outputs, summaries, and artifacts. */
function isolatedHome(): string {
  return mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "rootform-home-"));
}

function defaultCacheClient(): CacheClient {
  return {
    restore: async (paths, primary, restore) => {
      const cache = await import("@actions/cache");
      return cache.restoreCache([...paths], primary, [...restore]);
    },
    save: async (paths, primary) => {
      const cache = await import("@actions/cache");
      await cache.saveCache([...paths], primary);
    },
  };
}

const defaultDependencies: MainDependencies = {
  artifactClient: () => new DefaultArtifactClient(),
  cacheClient: defaultCacheClient,
  comment: upsertPullRequestComment,
  context: readGitHubContext,
  core,
  diff: runDiff,
  home: isolatedHome,
  install: installRootform,
  prepare: runPreparation,
  run: runAnalysis,
  workspace: () => resolve(process.env.GITHUB_WORKSPACE || process.cwd()),
  workflowUrl: readWorkflowUrl,
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
  preparation: Preparation;
  lockPath?: string;
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
    preparation: {
      dialects: options.preparation.dialects,
      lockCreated: options.preparation.lockWritten,
      lockPath: options.lockPath,
      resolutionMode: options.preparation.resolutionMode,
      unsupportedProviders: options.preparation.unsupportedProviders,
    },
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

    /* Preparation owns dialect resolution and must complete before any
       analysis command runs, so every later command observes the same
       resolved set. The CLI decides; this only orchestrates. */
    const locked = actionCore.getBooleanInput("locked");
    const offline = actionCore.getBooleanInput("offline");
    const home = (dependencies.home ?? isolatedHome)();
    actionCore.exportVariable?.("ROOTFORM_HOME", home);
    process.env.ROOTFORM_HOME = home;

    const projectRoot = mode === "source" ? inputPath : workspace;
    const lockFile = join(projectRoot, LOCK_FILE);
    const keys = cacheKeys({
      lockPath: lockFile,
      mode:
        locked && offline ? "locked-offline" : locked ? "locked" : offline ? "offline" : "default",
      platform: `${process.platform}-${process.arch}`,
      runId: process.env.GITHUB_RUN_ID,
      version: installation.version,
    });
    const cacheEnabled = actionCore.getBooleanInput("cache");
    const cacheClient = cacheEnabled
      ? (dependencies.cacheClient ?? defaultCacheClient)()
      : undefined;
    const cacheOutcome = cacheClient
      ? await restoreDialectCache({ client: cacheClient, home, keys, warn: actionCore.warning })
      : { restored: false };

    /* A preparation failure is not a check result: it never publishes an
       analysis exit code, and no analysis command runs after it. */
    const preparation = (dependencies.prepare ?? runPreparation)({
      binary: installation.binary,
      input: ".",
      locked,
      offline,
      workspace: projectRoot,
    });
    actionCore.setOutput("resolution-mode", preparation.resolutionMode);
    actionCore.setOutput("lock-created", String(preparation.lockWritten));
    const lockPath = existsSync(lockFile) ? relativeOutput(workspace, lockFile) : undefined;
    if (lockPath) actionCore.setOutput("lock-path", lockPath);
    if (preparation.lockWritten) actionCore.warning?.(GENERATED_LOCK_NOTICE);
    for (const warning of preparation.warnings) actionCore.warning?.(warning);

    if (cacheClient) {
      await saveDialectCache({
        client: cacheClient,
        home,
        keys,
        outcome: cacheOutcome,
        warn: actionCore.warning,
      });
    }

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
      /* A generated lock is evidence the caller must be able to retrieve, so
         it is copied into the artifact directory. It is never written back
         into the repository, staged, or committed. */
      let lockEvidence: string | undefined;
      if (preparation.lockWritten && existsSync(lockFile)) {
        lockEvidence = join(outputDirectory, LOCK_FILE);
        copyFileSync(lockFile, lockEvidence);
      }
      const files = [
        result.paths.architecture,
        result.paths.html,
        result.paths.policyJson,
        result.paths.sarif,
        ...(diffResult?.paths.baselineArchitecture ? [diffResult.paths.baselineArchitecture] : []),
        ...(diffResult?.paths.baselineHtml ? [diffResult.paths.baselineHtml] : []),
        ...(diffResult ? [diffResult.paths.json, diffResult.paths.markdown] : []),
        ...(lockEvidence ? [lockEvidence] : []),
      ];
      const artifact = await dependencies
        .artifactClient()
        .uploadArtifact(name, files, outputDirectory);
      if (artifact.id === undefined) throw new Error("artifact upload returned no identifier");
      actionCore.setOutput("artifact-id", String(artifact.id));
      const runUrl = (dependencies.workflowUrl ?? readWorkflowUrl)();
      artifactUrl =
        artifact.artifactUrl ?? (runUrl ? `${runUrl}/artifacts/${artifact.id}` : undefined);
      if (artifactUrl) {
        actionCore.setOutput("artifact-url", artifactUrl);
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
        lockPath,
        mode,
        policyExitCode: result.exitCode,
        policyMarkdown,
        preparation,
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
