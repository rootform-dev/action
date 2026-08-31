import { describe, expect, test } from "bun:test";
import type { FetchLike } from "./github.ts";
import {
  type PullRequestIdentity,
  readGitHubContext,
  upsertPullRequestComment,
} from "./pull-request.ts";
import { REPORT_MARKER } from "./report.ts";

function event(headRepository = "rootform-dev/action"): string {
  return JSON.stringify({
    number: 17,
    pull_request: {
      base: { repo: { full_name: "rootform-dev/action" }, sha: "a".repeat(40) },
      head: { repo: { full_name: headRepository }, sha: "b".repeat(40) },
    },
    repository: { full_name: "rootform-dev/action" },
  });
}

const environment = {
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_EVENT_PATH: "/event.json",
  GITHUB_REPOSITORY: "rootform-dev/action",
  GITHUB_RUN_ID: "71",
  GITHUB_SERVER_URL: "https://github.com",
};

const identity: PullRequestIdentity = {
  apiUrl: "https://api.github.com",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  number: 17,
  repository: "rootform-dev/action",
  sameRepository: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("GitHub pull-request reporting", () => {
  test("reads exact same-repository and fork identity", () => {
    const same = readGitHubContext(environment, () => event());
    expect(same).toEqual({
      eventName: "pull_request",
      pullRequest: identity,
      workflowUrl: "https://github.com/rootform-dev/action/actions/runs/71",
    });

    const fork = readGitHubContext(environment, () => event("contributor/action"));
    expect(fork.pullRequest?.sameRepository).toBeFalse();

    const push = readGitHubContext({ ...environment, GITHUB_EVENT_NAME: "push" }, () => {
      throw new Error("event must not be read");
    });
    expect(push.pullRequest).toBeUndefined();
    expect(push.workflowUrl).toBe("https://github.com/rootform-dev/action/actions/runs/71");
  });

  test("rejects malformed or mismatched pull-request identity", () => {
    expect(() => readGitHubContext(environment, () => "not-json")).toThrow("invalid JSON");
    expect(() =>
      readGitHubContext(environment, () => event().replace(`"${"a".repeat(40)}"`, '"short"')),
    ).toThrow("pull_request.base.sha");
    expect(() =>
      readGitHubContext({ ...environment, GITHUB_REPOSITORY: "rootform-dev/other" }, () => event()),
    ).toThrow("does not match workflow repository");
  });

  test("upserts one safe report", async () => {
    const calls: Array<{
      authorization: string | null;
      body?: string;
      method: string;
      url: string;
    }> = [];
    const fetcher: FetchLike = async (input, init) => {
      const call = {
        authorization: new Headers(init?.headers).get("Authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
        method: init?.method ?? "GET",
        url: String(input),
      };
      calls.push(call);
      if (call.method === "GET") {
        return json([
          {
            body: `${REPORT_MARKER}\nold`,
            id: 29,
            user: { login: "github-actions[bot]" },
          },
          { body: REPORT_MARKER, id: 30, user: { login: "human" } },
        ]);
      }
      return json({
        html_url: "https://github.com/rootform-dev/action/pull/17#issuecomment-29",
        id: 29,
      });
    };

    const result = await upsertPullRequestComment({
      body: `${REPORT_MARKER}\nnew`,
      fetcher,
      identity,
      token: "comment-token",
    });
    expect(result).toEqual({
      action: "updated",
      htmlUrl: "https://github.com/rootform-dev/action/pull/17#issuecomment-29",
      id: 29,
    });
    expect(calls).toEqual([
      {
        authorization: "Bearer comment-token",
        body: undefined,
        method: "GET",
        url: "https://api.github.com/repos/rootform-dev/action/issues/17/comments?per_page=100&page=1",
      },
      {
        authorization: "Bearer comment-token",
        body: JSON.stringify({ body: `${REPORT_MARKER}\nnew` }),
        method: "PATCH",
        url: "https://api.github.com/repos/rootform-dev/action/issues/comments/29",
      },
    ]);
  });

  test("creates once, rejects duplicate ownership, and blocks forks", async () => {
    const methods: string[] = [];
    const createFetcher: FetchLike = async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return init?.method === "POST"
        ? json({
            html_url: "https://github.com/rootform-dev/action/pull/17#issuecomment-31",
            id: 31,
          })
        : json([]);
    };
    expect(
      await upsertPullRequestComment({
        body: REPORT_MARKER,
        fetcher: createFetcher,
        identity,
        token: "token",
      }),
    ).toEqual({
      action: "created",
      htmlUrl: "https://github.com/rootform-dev/action/pull/17#issuecomment-31",
      id: 31,
    });
    expect(methods).toEqual(["GET", "POST"]);

    const duplicateFetcher: FetchLike = async () =>
      json([
        { body: REPORT_MARKER, id: 1, user: { login: "github-actions[bot]" } },
        { body: REPORT_MARKER, id: 2, user: { login: "github-actions[bot]" } },
      ]);
    await expect(
      upsertPullRequestComment({
        body: REPORT_MARKER,
        fetcher: duplicateFetcher,
        identity,
        token: "token",
      }),
    ).rejects.toThrow("multiple Rootform");

    await expect(
      upsertPullRequestComment({
        body: REPORT_MARKER,
        fetcher: async () => {
          throw new Error("must not call network");
        },
        identity: { ...identity, sameRepository: false },
        token: "token",
      }),
    ).rejects.toThrow("disabled for fork");
  });
});
