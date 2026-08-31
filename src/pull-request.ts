import { readFileSync } from "node:fs";
import type { FetchLike } from "./github.ts";
import { REPORT_MARKER } from "./report.ts";

const API_VERSION = "2026-03-10";
const USER_AGENT = "rootform-action";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/iu;

export type PullRequestIdentity = {
  apiUrl: string;
  baseSha: string;
  headSha: string;
  number: number;
  repository: string;
  sameRepository: boolean;
};

export type GitHubContext = {
  eventName: string;
  pullRequest?: PullRequestIdentity;
  workflowUrl?: string;
};

export type CommentResult = {
  action: "created" | "updated";
  htmlUrl: string;
  id: number;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub event has invalid ${label}`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`GitHub event has invalid ${label}`);
  return value;
}

function repository(value: unknown, label: string): string {
  const resolved = string(value, label);
  if (!REPOSITORY_PATTERN.test(resolved)) throw new Error(`GitHub event has invalid ${label}`);
  return resolved;
}

function sha(value: unknown, label: string): string {
  const resolved = string(value, label);
  if (!SHA_PATTERN.test(resolved)) throw new Error(`GitHub event has invalid ${label}`);
  return resolved.toLowerCase();
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`GitHub event has invalid ${label}`);
  }
  return value as number;
}

function trustedUrl(value: string, label: string, allowHash = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`GitHub environment has invalid ${label}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    (!allowHash && url.hash)
  ) {
    throw new Error(`GitHub environment has invalid ${label}`);
  }
  return url.toString().replace(/\/$/u, "");
}

export function readWorkflowUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const server = environment.GITHUB_SERVER_URL;
  const repositoryName = environment.GITHUB_REPOSITORY;
  const runId = environment.GITHUB_RUN_ID;
  if (!server || !repositoryName || !runId) return undefined;
  if (!REPOSITORY_PATTERN.test(repositoryName) || !/^[1-9][0-9]*$/u.test(runId)) {
    throw new Error("GitHub environment has invalid workflow identity");
  }
  return `${trustedUrl(server, "GITHUB_SERVER_URL")}/${repositoryName}/actions/runs/${runId}`;
}

export function readGitHubContext(
  environment: NodeJS.ProcessEnv = process.env,
  readEvent: (path: string) => string = (path) => readFileSync(path, "utf8"),
): GitHubContext {
  const eventName = environment.GITHUB_EVENT_NAME || "";
  const context: GitHubContext = {
    eventName,
    workflowUrl: readWorkflowUrl(environment),
  };
  if (eventName !== "pull_request") return context;

  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GitHub pull_request event path is unavailable");
  let payload: JsonObject;
  try {
    payload = object(JSON.parse(readEvent(eventPath)), "payload");
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("GitHub pull_request event is invalid JSON");
    throw error;
  }
  const pullRequest = object(payload.pull_request, "pull_request");
  const base = object(pullRequest.base, "pull_request.base");
  const head = object(pullRequest.head, "pull_request.head");
  const eventRepository = repository(
    object(payload.repository, "repository").full_name,
    "repository.full_name",
  );
  const baseRepository = repository(
    object(base.repo, "pull_request.base.repo").full_name,
    "pull_request.base.repo.full_name",
  );
  if (baseRepository !== eventRepository) {
    throw new Error("GitHub pull_request base repository does not match event repository");
  }
  if (environment.GITHUB_REPOSITORY && environment.GITHUB_REPOSITORY !== eventRepository) {
    throw new Error("GitHub pull_request repository does not match workflow repository");
  }
  const headRepoValue = head.repo;
  const headRepository = headRepoValue
    ? repository(
        object(headRepoValue, "pull_request.head.repo").full_name,
        "pull_request.head.repo.full_name",
      )
    : undefined;

  context.pullRequest = {
    apiUrl: trustedUrl(environment.GITHUB_API_URL || "https://api.github.com", "GITHUB_API_URL"),
    baseSha: sha(base.sha, "pull_request.base.sha"),
    headSha: sha(head.sha, "pull_request.head.sha"),
    number: positiveInteger(payload.number, "pull request number"),
    repository: eventRepository,
    sameRepository: headRepository === eventRepository,
  };
  return context;
}

function requestHeaders(token: string): Headers {
  return new Headers({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  });
}

async function jsonResponse(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(
      `GitHub pull-request comment ${operation} failed with status ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub pull-request comment ${operation} returned invalid JSON`);
  }
}

function commentResult(value: unknown, action: CommentResult["action"]): CommentResult {
  const comment = object(value, "comment response");
  const id = positiveInteger(comment.id, "comment identifier");
  const htmlUrl = string(comment.html_url, "comment URL");
  const parsed = trustedUrl(htmlUrl, "comment URL", true);
  return { action, htmlUrl: parsed, id };
}

export async function upsertPullRequestComment(options: {
  body: string;
  fetcher?: FetchLike;
  identity: PullRequestIdentity;
  token: string;
}): Promise<CommentResult> {
  if (!options.token) throw new Error("pull-request-token is required for comment publishing");
  if (!options.identity.sameRepository) {
    throw new Error("pull-request comments are disabled for fork pull requests");
  }
  const fetcher = options.fetcher ?? fetch;
  const headers = requestHeaders(options.token);
  const comments: JsonObject[] = [];
  const repositoryPath = options.identity.repository
    .split("/")
    .map((component) => encodeURIComponent(component))
    .join("/");
  const issuePath = `${options.identity.apiUrl}/repos/${repositoryPath}/issues/${options.identity.number}`;

  for (let page = 1; page <= 100; page++) {
    const response = await fetcher(`${issuePath}/comments?per_page=100&page=${page}`, {
      headers,
      redirect: "error",
    });
    const value = await jsonResponse(response, "list");
    if (!Array.isArray(value)) {
      throw new Error("GitHub pull-request comment list returned invalid JSON");
    }
    const pageComments = value.map((comment) => object(comment, "comment list item"));
    comments.push(...pageComments);
    if (pageComments.length < 100) break;
    if (page === 100) throw new Error("GitHub pull-request comment list exceeded 100 pages");
  }

  const owned = comments.filter((comment) => {
    const author = comment.user;
    return (
      author !== null &&
      typeof author === "object" &&
      !Array.isArray(author) &&
      (author as JsonObject).login === "github-actions[bot]" &&
      typeof comment.body === "string" &&
      comment.body.includes(REPORT_MARKER)
    );
  });
  if (owned.length > 1) {
    throw new Error("multiple Rootform pull-request report comments already exist");
  }

  const existing = owned[0];
  if (existing) {
    const id = positiveInteger(existing.id, "existing comment identifier");
    const response = await fetcher(
      `${options.identity.apiUrl}/repos/${repositoryPath}/issues/comments/${id}`,
      {
        body: JSON.stringify({ body: options.body }),
        headers,
        method: "PATCH",
        redirect: "error",
      },
    );
    return commentResult(await jsonResponse(response, "update"), "updated");
  }

  const response = await fetcher(`${issuePath}/comments`, {
    body: JSON.stringify({ body: options.body }),
    headers,
    method: "POST",
    redirect: "error",
  });
  return commentResult(await jsonResponse(response, "create"), "created");
}
