import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DefaultArtifactClient, type UploadArtifactResponse } from "@actions/artifact";
import * as core from "@actions/core";
import {
  type CacheClient,
  cacheKeys,
  restoreDependencyCache,
  saveDependencyCache,
} from "./cache.ts";
import { type Installation, installRootform } from "./install.ts";
import { containedInput } from "./paths.ts";
import { runPreparation } from "./preparation.ts";
import { assertPublicMessage } from "./publication-safety.ts";
import {
  type CommentResult,
  type GitHubContext,
  readGitHubContext,
  upsertPullRequestComment,
} from "./pull-request.ts";
import { combineReports, REPORT_MARKER, renderReport } from "./report.ts";
import {
  type CommandRunner,
  type ExecutionResult,
  type RunOptions,
  runBusiness,
  savedFormHint,
} from "./run.ts";

export type ActionKind = "main" | "setup" | "init" | "analyze" | "compare" | "check";
export type ActionCore = Pick<
  typeof core,
  "getInput" | "setOutput" | "setFailed" | "exportVariable" | "setSecret" | "warning"
> & {
  summary: { addRaw(value: string): { write(): Promise<unknown> } };
};
export type MainDependencies = {
  core: ActionCore;
  install(options: { token: string; version: string }): Promise<Installation>;
  environment: NodeJS.ProcessEnv;
  context(): GitHubContext;
  runner?: CommandRunner;
  run?(options: RunOptions): ExecutionResult;
  comment(options: Parameters<typeof upsertPullRequestComment>[0]): Promise<CommentResult>;
  artifactClient(): {
    uploadArtifact(
      name: string,
      files: string[],
      directory: string,
      options: { retentionDays: number },
    ): Promise<UploadArtifactResponse>;
  };
  cacheClient(): CacheClient;
};
const defaults: MainDependencies = {
  core,
  install: installRootform,
  environment: process.env,
  context: readGitHubContext,
  comment: upsertPullRequestComment,
  artifactClient: () => new DefaultArtifactClient(),
  cacheClient: () => ({
    restore: async (paths, primary, restore) =>
      (await import("@actions/cache")).restoreCache([...paths], primary, [...restore]),
    save: async (paths, primary) => {
      await (await import("@actions/cache")).saveCache([...paths], primary);
    },
  }),
};

function booleanInput(actionCore: ActionCore, name: string, fallback = false): boolean {
  const value = actionCore.getInput(name);
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
function lines(actionCore: ActionCore, name: string): string[] {
  return actionCore
    .getInput(name)
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}
export function sanitized(error: unknown, roots: string[], secrets: string[]): string {
  let value = error instanceof Error ? error.message : String(error);
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length))
    value = value.replaceAll(secret, "***");
  for (const root of roots.filter(Boolean).sort((a, b) => b.length - a.length))
    value = value.replaceAll(root, "<runner-path>");
  return value.slice(0, 12_000);
}

export async function main(
  kind: ActionKind = "main",
  dependencies: MainDependencies = defaults,
): Promise<void> {
  const actionCore = dependencies.core;
  const env = dependencies.environment;
  const workspace = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const temporary = resolve(env.RUNNER_TEMP || tmpdir());
  const token = actionCore.getInput("github-token");
  if (token) actionCore.setSecret(token);
  const roots = [
    workspace,
    temporary,
    env.RUNNER_TOOL_CACHE || "",
    env.HOME || "",
    env.USERPROFILE || "",
  ];
  const failures: unknown[] = [];
  let installation: Installation | undefined;
  let directory: string | undefined;
  let execution: ExecutionResult | undefined;
  let artifactUrl: string | undefined;
  let context: GitHubContext = { eventName: "" };
  let commentState: string | undefined;
  const business = kind !== "setup" && kind !== "init";
  let summary = false;
  let upload = false;
  let commenting = false;

  try {
    summary = business ? booleanInput(actionCore, "summary", true) : false;
    upload = business ? booleanInput(actionCore, "upload-artifact", true) : false;
    commenting = kind === "main" ? booleanInput(actionCore, "comment") : false;
    if (kind !== "setup" && env.GITHUB_EVENT_NAME === "pull_request_target")
      throw new Error(
        "Use pull_request with minimal permissions; pull_request_target execution is not supported",
      );
    const requested = actionCore.getInput("version") || env.ROOTFORM_VERSION || "";
    installation = await dependencies.install({ token, version: requested });
    actionCore.setOutput("version", installation.version);
    actionCore.exportVariable("ROOTFORM_VERSION", installation.version);
    env.ROOTFORM_VERSION = installation.version;
    if (kind === "setup") {
      actionCore.setOutput("sha256", installation.sha256);
      return;
    }
    mkdirSync(temporary, { recursive: true });
    const home = env.ROOTFORM_HOME ? resolve(env.ROOTFORM_HOME) : join(temporary, "rootform-home");
    mkdirSync(home, { recursive: true });
    actionCore.exportVariable("ROOTFORM_HOME", home);
    env.ROOTFORM_HOME = home;
    const projectInput = actionCore.getInput("project");
    const project = containedInput(workspace, projectInput || ".", "directory", "project");
    const locked = booleanInput(actionCore, "locked");
    const offline = booleanInput(actionCore, "offline");
    const cacheEnabled = booleanInput(actionCore, "cache", true);
    const input = actionCore.getInput("input");
    const before = actionCore.getInput("before");
    const after = actionCore.getInput("after");
    const file = (value: string, name: string) =>
      value ? containedInput(workspace, value, "file", name, temporary) : undefined;
    const inputFile = file(input, "input");
    const beforeFile = file(before, "before");
    const afterFile = file(after, "after");
    const comparing = kind === "compare" || (kind === "main" && Boolean(before || after));
    if (business) {
      if (
        comparing
          ? !beforeFile || !afterFile || Boolean(inputFile)
          : !inputFile || Boolean(beforeFile || afterFile)
      )
        throw new Error("Supply input, or both before and after, with no conflicting files");
    }
    const policies = lines(actionCore, "policy");
    const policyPacks = lines(actionCore, "policy-pack").map((value) => {
      const path = resolve(workspace, value);
      return containedInput(
        workspace,
        value,
        lstatSync(path).isDirectory() ? "directory" : "file",
        "policy-pack",
        temporary,
      );
    });
    const checking =
      kind === "check" ||
      (kind === "main" &&
        (booleanInput(actionCore, "check") || policies.length > 0 || policyPacks.length > 0));
    const operands = comparing ? [beforeFile, afterFile] : [inputFile];
    const raw = operands.some((path) => path && !savedFormHint(path));
    if (business && !raw && !checking && (projectInput || locked || offline))
      throw new Error(
        "project, locked and offline govern raw evidence or Policy selection; saved Forms reopen alone",
      );
    const planFile = file(actionCore.getInput("plan-file"), "plan-file");
    const beforePlanFile = file(actionCore.getInput("before-plan-file"), "before-plan-file");
    const afterPlanFile = file(actionCore.getInput("after-plan-file"), "after-plan-file");
    if (planFile && (!inputFile || savedFormHint(inputFile)))
      throw new Error("plan-file requires a plan export input");
    if (
      !comparing &&
      (beforePlanFile ||
        afterPlanFile ||
        actionCore.getInput("before-stage") ||
        actionCore.getInput("after-stage"))
    )
      throw new Error("Comparison evidence and stages require before and after");
    if (comparing && planFile)
      throw new Error("Use before-plan-file or after-plan-file for comparison evidence");
    const needsPreparation = kind === "init" || raw || checking;
    if (needsPreparation) {
      const lock = join(project, "rootform.lock");
      const cache = cacheEnabled && existsSync(lock) ? dependencies.cacheClient() : undefined;
      const keys = cache
        ? cacheKeys({
            lockPath: lock,
            platform: `${process.platform}-${process.arch}`,
            version: installation.version,
          })
        : undefined;
      const outcome =
        cache && keys
          ? await restoreDependencyCache({ client: cache, home, keys, warn: actionCore.warning })
          : { restored: false };
      runPreparation({
        binary: installation.binary,
        project,
        workspace,
        locked,
        offline,
        runner: dependencies.runner,
      });
      if (cache && keys)
        await saveDependencyCache({ client: cache, home, keys, outcome, warn: actionCore.warning });
    }
    if (kind === "init") return;
    directory = mkdtempSync(join(temporary, "rootform-results-"));
    execution = (dependencies.run ?? runBusiness)({
      binary: installation.binary,
      kind,
      workspace,
      project,
      locked,
      input: inputFile,
      before: beforeFile,
      after: afterFile,
      planFile,
      beforePlanFile,
      afterPlanFile,
      stage: actionCore.getInput("stage") || undefined,
      beforeStage: actionCore.getInput("before-stage") || undefined,
      afterStage: actionCore.getInput("after-stage") || undefined,
      side: actionCore.getInput("side") || undefined,
      policies,
      policyPacks,
      check: checking,
      outputDirectory: directory,
      runner: dependencies.runner,
    });
    if (execution.failure) failures.push(execution.failure);
    const report = combineReports(execution.reports, directory);
    if (report) execution.paths.report = report;
    for (const [name, path] of Object.entries(execution.paths))
      if (path) actionCore.setOutput(name, path);
    if (execution.exitCode !== undefined)
      actionCore.setOutput("exit-code", String(execution.exitCode));
    context = dependencies.context();
  } catch (error) {
    failures.push(error);
  }

  // Each evidence channel is attempted before the gate, even if another
  // transport fails. The upload inventory is derived files only, never a glob.
  if (upload && execution && directory && Object.keys(execution.paths).length > 0) {
    try {
      const value = actionCore.getInput("retention-days") || "7";
      if (!/^[1-9][0-9]*$/u.test(value) || Number(value) > 90)
        throw new Error("retention-days must be an integer from 1 to 90");
      const staging = join(directory, "artifact");
      mkdirSync(staging);
      const files: string[] = [];
      for (const [name, path] of Object.entries(execution.paths)) {
        if (!path || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())
          throw new Error("Evidence file must remain a regular file");
        const filenames: Record<string, string> = {
          form: "form.json",
          result: "result.json",
          report: "report.md",
          html: "explorer.html",
          sarif: "results.sarif",
        };
        const filename = filenames[name];
        if (!filename) throw new Error("Unexpected evidence output");
        const target = join(staging, filename);
        copyFileSync(path, target);
        files.push(target);
      }
      const name =
        actionCore.getInput("artifact-name") ||
        `rootform-${kind}-${env.GITHUB_JOB || "job"}-${basename(directory)}`;
      const artifact = await dependencies
        .artifactClient()
        .uploadArtifact(name, files, staging, { retentionDays: Number(value) });
      if (!Number.isSafeInteger(artifact.id) || !artifact.id || artifact.id < 1) {
        throw new Error("GitHub artifact upload returned no valid artifact identifier");
      }
      actionCore.setOutput("artifact-id", String(artifact.id));
      if (context.workflowUrl) {
        artifactUrl = `${context.workflowUrl}/artifacts/${artifact.id}`;
        actionCore.setOutput("artifact-url", artifactUrl);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  let markdown: string | undefined;
  try {
    markdown = execution?.paths.report ? readFileSync(execution.paths.report, "utf8") : undefined;
  } catch (error) {
    failures.push(error);
  }
  const report = (limit?: number) =>
    renderReport({
      version: installation?.version || "not installed",
      markdown,
      artifactUrl,
      workflowUrl: context.workflowUrl,
      commentState,
      limit,
    });
  if (commenting) {
    try {
      if (!context.pullRequest?.sameRepository || context.eventName !== "pull_request")
        commentState = "skipped (not an eligible same-repository pull_request)";
      else {
        assertPublicMessage(report(60_000));
        const result = await dependencies.comment({
          token,
          identity: context.pullRequest,
          body: `${REPORT_MARKER}\n${report(60_000)}`,
          runId: context.runId,
          runAttempt: context.runAttempt,
        });
        commentState = result.action === "skipped" ? `skipped (${result.reason})` : result.action;
      }
    } catch (error) {
      failures.push(error);
      commentState = "failed; see step diagnostic";
    }
  }
  if (summary) {
    try {
      const publicReport = report();
      assertPublicMessage(publicReport);
      await actionCore.summary.addRaw(publicReport).write();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    actionCore.setFailed(failures.map((error) => sanitized(error, roots, [token])).join("\n"));
}

export async function runEntry(kind: ActionKind): Promise<void> {
  try {
    await main(kind);
  } catch (error) {
    core.setFailed(
      sanitized(
        error,
        [process.env.GITHUB_WORKSPACE || "", process.env.RUNNER_TEMP || "", process.env.HOME || ""],
        [core.getInput("github-token")],
      ),
    );
  }
}
