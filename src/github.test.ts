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

  test("uses optional token to resolve an exact private published prerelease", async () => {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url,
      });
      return json({
        assets: [],
        draft: false,
        prerelease: true,
        tag_name: "v0.1.0-dev.2",
      });
    };

    const resolved = await resolveRelease("0.1.0-dev.2", "private-token", fetcher);
    expect(resolved.release.draft).toBeFalse();
    expect(resolved.release.prerelease).toBeTrue();
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.authorization === "Bearer private-token")).toBeTrue();
    expect(calls[0]?.url).toEndWith("/releases/tags/v0.1.0-dev.2");
  });

  test("rejects an exact draft even with a private token", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (input) => {
      calls.push(String(input));
      return json({
        assets: [],
        draft: true,
        prerelease: true,
        tag_name: "v0.1.0-dev.2",
      });
    };

    await expect(resolveRelease("0.1.0-dev.2", "private-token", fetcher)).rejects.toThrow(
      "draft Rootform releases are not installable",
    );
    expect(calls).toEqual([
      "https://api.github.com/repos/rootform-dev/rootform/releases/tags/v0.1.0-dev.2",
    ]);
  });

  test("does not list releases when an exact tag is unavailable", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (input) => {
      calls.push(String(input));
      return json({}, 404);
    };

    await expect(resolveRelease("0.1.0-dev.2", "private-token", fetcher)).rejects.toThrow(
      "Rootform release v0.1.0-dev.2 was not found",
    );
    expect(calls).toEqual([
      "https://api.github.com/repos/rootform-dev/rootform/releases/tags/v0.1.0-dev.2",
    ]);
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
