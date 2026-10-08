import { describe, expect, test } from "bun:test";
import type { FetchLike } from "./github.ts";
import { readGitHubContext, upsertPullRequestComment } from "./pull-request.ts";
import { REPORT_MARKER } from "./report.ts";

const sha = "a".repeat(40);
const identity = {
  apiUrl: "https://api.github.com",
  baseSha: "b".repeat(40),
  headSha: sha,
  number: 4,
  repository: "example/project",
  sameRepository: true,
};
const stamp = "<!-- rootform-run:20:10:100:1:2026-10-02T10:00:00Z -->";

test("synthetic private report content is refused before any request", async () => {
  let requests = 0;
  await expect(
    upsertPullRequestComment({
      body: "/" + "Users/fictional/private-report",
      identity,
      token: "synthetic-test-token",
      runId: "100",
      runAttempt: "1",
      fetcher: async () => {
        requests++;
        return Response.json({});
      },
    }),
  ).rejects.toThrow("Public message refused: personal-path");
  expect(requests).toBe(0);
});
function github(
  options: {
    comments?: unknown[];
    head?: string;
    finalHead?: string;
    attempt?: number;
    newer?: boolean;
    invalidRun?: boolean;
    failWrite?: boolean;
  } = {},
) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let headReads = 0;
  const fetcher: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/pulls/4")) {
      headReads++;
      return json({
        state: "open",
        head: {
          sha: headReads > 1 ? options.finalHead || options.head || sha : options.head || sha,
        },
      });
    }
    if (url.endsWith("/actions/runs/100"))
      return json({
        id: options.invalidRun ? 101 : 100,
        event: "pull_request",
        workflow_id: 20,
        run_number: 10,
        run_attempt: options.attempt || 1,
        created_at: "2026-10-02T10:00:00Z",
      });
    if (url.includes("/actions/workflows/20/runs?"))
      return json({ workflow_runs: options.newer ? [{ run_number: 11 }] : [] });
    if (method === "GET" && url.includes("/comments?")) return json(options.comments || []);
    if (method === "PATCH" || method === "POST") {
      if (options.failWrite) return new Response(null, { status: 403 });
      return json({
        id: 55,
        html_url: "https://github.com/example/project/pull/4#issuecomment-55",
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetcher, calls };
}
const owned = (body: string) => ({ id: 55, body, user: { login: "github-actions[bot]" } });
const run = (fetcher: FetchLike, body = "EXACT CLI REPORT") =>
  upsertPullRequestComment({
    body: `${REPORT_MARKER}\n${body}`,
    identity,
    token: "unit-secret",
    runId: "100",
    runAttempt: "1",
    fetcher,
  });

describe("single current PR report", () => {
  test("creates once then updates marker-owned bot comment with run provenance", async () => {
    const created = github();
    expect((await run(created.fetcher)).action).toBe("created");
    const post = created.calls.find((c) => c.method === "POST");
    expect(JSON.parse(post?.body || "{}").body).toContain(stamp);
    expect(JSON.parse(post?.body || "{}").body).toContain("EXACT CLI REPORT");
    const updated = github({ comments: [owned(`${stamp}\n${REPORT_MARKER}\nold`)] });
    expect((await run(updated.fetcher)).action).toBe("updated");
    expect(updated.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(updated.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  test("old HEAD never writes; HEAD is rechecked immediately before mutation", async () => {
    for (const config of [{ head: "c".repeat(40) }, { finalHead: "c".repeat(40) }]) {
      const f = github(config);
      expect((await run(f.fetcher)).action).toBe("skipped");
      expect(f.calls.every((call) => call.method === "GET")).toBe(true);
    }
  });

  test("newer same-HEAD run and rerun attempt suppress older writer", async () => {
    for (const config of [
      { newer: true },
      { attempt: 2 },
      {
        comments: [
          owned(`<!-- rootform-run:20:11:101:1:2026-10-02T10:01:00Z -->\n${REPORT_MARKER}`),
        ],
      },
      {
        comments: [
          owned(`<!-- rootform-run:20:10:100:2:2026-10-02T10:00:00Z -->\n${REPORT_MARKER}`),
        ],
      },
    ]) {
      const f = github(config);
      expect((await run(f.fetcher)).action).toBe("skipped");
      expect(f.calls.every((call) => call.method === "GET")).toBe(true);
    }
  });

  test("a newer report from another workflow is not replaced by an old run", async () => {
    const f = github({
      comments: [owned(`<!-- rootform-run:21:1:105:1:2026-10-02T10:03:00Z -->\n${REPORT_MARKER}`)],
    });
    expect((await run(f.fetcher)).action).toBe("skipped");
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
  });

  test("duplicate owned comments fail instead of adding more", async () => {
    const f = github({ comments: [owned(REPORT_MARKER), { ...owned(REPORT_MARKER), id: 56 }] });
    await expect(run(f.fetcher)).rejects.toThrow("multiple Rootform");
    expect(f.calls.every((call) => call.method === "GET")).toBe(true);
  });

  test("foreign marker does not grant ownership of a human comment", async () => {
    const f = github({ comments: [{ id: 54, body: REPORT_MARKER, user: { login: "someone" } }] });
    expect((await run(f.fetcher)).action).toBe("created");
    expect(f.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  });

  test("fork, untrusted API URL, missing run identity and mismatched run fail before writes", async () => {
    const f = github();
    await expect(
      upsertPullRequestComment({
        body: "report",
        identity: { ...identity, sameRepository: false },
        token: "unit-secret",
        fetcher: f.fetcher,
      }),
    ).rejects.toThrow("fork");
    await expect(
      upsertPullRequestComment({
        body: "report",
        identity: { ...identity, apiUrl: "https://attacker.example" },
        token: "unit-secret",
        fetcher: f.fetcher,
      }),
    ).rejects.toThrow("GitHub.com");
    await expect(
      upsertPullRequestComment({
        body: "report",
        identity,
        token: "unit-secret",
        fetcher: f.fetcher,
      }),
    ).rejects.toThrow("identifier");
    expect(f.calls).toEqual([]);
    const mismatched = github({ invalidRun: true });
    await expect(run(mismatched.fetcher)).rejects.toThrow("identity");
    expect(mismatched.calls.every((call) => call.method === "GET")).toBe(true);
  });

  test("requested comment permission failure is explicit without token/body leak", async () => {
    const f = github({ failWrite: true });
    await expect(run(f.fetcher)).rejects.toThrow("status 403");
  });
});

describe("GitHub event trust boundary", () => {
  const payload = {
    number: 4,
    repository: { full_name: "example/project" },
    pull_request: {
      base: { sha: "b".repeat(40), repo: { full_name: "example/project" } },
      head: { sha, repo: { full_name: "example/project" } },
    },
  };
  const environment = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: "event.json",
    GITHUB_REPOSITORY: "example/project",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "1",
  };
  test("reads exact PR identity and separates forks", () => {
    const context = readGitHubContext(environment, () => JSON.stringify(payload));
    expect(context.pullRequest).toEqual(identity);
    expect(context.runId).toBe("100");
    const fork = structuredClone(payload);
    fork.pull_request.head.repo.full_name = "fork/project";
    expect(
      readGitHubContext(environment, () => JSON.stringify(fork)).pullRequest?.sameRepository,
    ).toBe(false);
  });
  test("privileged/non-PR events never acquire PR identity", () => {
    expect(
      readGitHubContext({ ...environment, GITHUB_EVENT_NAME: "pull_request_target" }, () => {
        throw new Error("must not read");
      }).pullRequest,
    ).toBeUndefined();
  });
  test("malformed SHA, mismatched repository and unsafe links fail", () => {
    const bad = structuredClone(payload);
    bad.pull_request.head.sha = "unsafe";
    expect(() => readGitHubContext(environment, () => JSON.stringify(bad))).toThrow("sha");
    expect(() =>
      readGitHubContext({ ...environment, GITHUB_REPOSITORY: "other/project" }, () =>
        JSON.stringify(payload),
      ),
    ).toThrow("repository");
    expect(() =>
      readGitHubContext(
        { ...environment, GITHUB_SERVER_URL: "https://github.com@attacker.example?token=bad" },
        () => JSON.stringify(payload),
      ),
    ).toThrow("GITHUB_SERVER_URL");
  });
});
