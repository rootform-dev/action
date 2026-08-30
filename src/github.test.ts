import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadReleaseAsset,
  type FetchLike,
  normalizeVersion,
  resolveRelease,
} from "./github.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("GitHub release client", () => {
  test("normalizes exact versions and rejects floating or malformed input", () => {
    expect(normalizeVersion("v1.2.3-dev.1")).toBe("1.2.3-dev.1");
    expect(normalizeVersion("latest")).toBe("latest");
    expect(() => normalizeVersion("main")).toThrow("invalid");
    expect(() => normalizeVersion("1.2")).toThrow("invalid");
  });

  test("resolves public latest without authorization", async () => {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url: String(input),
      });
      return json({ assets: [], draft: false, prerelease: false, tag_name: "v1.2.3" });
    };

    const resolved = await resolveRelease("latest", "", fetcher);
    expect(resolved.version).toBe("1.2.3");
    expect(calls).toEqual([
      {
        authorization: null,
        url: "https://api.github.com/repos/rootform-dev/rootform/releases/latest",
      },
    ]);
  });

  test("uses optional token to resolve an exact private draft", async () => {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url,
      });
      if (url.endsWith("/releases/tags/v0.1.0-dev.1")) return json({}, 404);
      return json([
        {
          assets: [],
          draft: true,
          prerelease: true,
          tag_name: "v0.1.0-dev.1",
        },
      ]);
    };

    const resolved = await resolveRelease("0.1.0-dev.1", "private-token", fetcher);
    expect(resolved.release.draft).toBeTrue();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.authorization === "Bearer private-token")).toBeTrue();
  });

  test("downloads exact asset bytes and rejects size drift", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rootform-github-test-"));
    try {
      const destination = join(directory, "asset");
      const fetcher: FetchLike = async () => new Response("abc");
      await downloadReleaseAsset(
        { id: 7, name: "asset", size: 3, url: "unused" },
        destination,
        "",
        fetcher,
      );
      expect(readFileSync(destination, "utf8")).toBe("abc");

      await expect(
        downloadReleaseAsset(
          { id: 8, name: "other", size: 4, url: "unused" },
          join(directory, "other"),
          "",
          fetcher,
        ),
      ).rejects.toThrow("size changed");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
