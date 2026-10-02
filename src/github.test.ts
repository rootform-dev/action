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

function publishedRelease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assets: [],
    draft: false,
    immutable: true,
    prerelease: false,
    tag_name: "v1.2.3",
    ...overrides,
  };
}

describe("GitHub release client", () => {
  test("accepts exact stable and prerelease versions, rejecting selectors and malformed values", () => {
    expect(normalizeVersion("v1.2.3-dev.1")).toBe("1.2.3-dev.1");
    expect(normalizeVersion("1.2.3+build.4")).toBe("1.2.3+build.4");
    for (const version of ["latest", "^1.2.3", "~1.2", "1.2.x", "main", "1.2", " 1.2.3"]) {
      expect(() => normalizeVersion(version)).toThrow("exact semantic version");
    }
  });

  test("resolves an exact public release anonymously", async () => {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url: String(input),
      });
      return json(publishedRelease());
    };

    const resolved = await resolveRelease("1.2.3", "", fetcher);
    expect(resolved.version).toBe("1.2.3");
    expect(calls).toEqual([
      {
        authorization: null,
        url: "https://api.github.com/repos/rootform-dev/rootform/releases/tags/v1.2.3",
      },
    ]);
  });

  test("resolves an exact published prerelease with an optional token", async () => {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        url: String(input),
      });
      return json(
        publishedRelease({
          prerelease: true,
          tag_name: "v0.1.0-dev.2",
        }),
      );
    };

    const resolved = await resolveRelease("0.1.0-dev.2", "private-token", fetcher);
    expect(resolved.release.draft).toBeFalse();
    expect(resolved.release.immutable).toBeTrue();
    expect(resolved.release.prerelease).toBeTrue();
    expect(calls).toEqual([
      {
        authorization: "Bearer private-token",
        url: "https://api.github.com/repos/rootform-dev/rootform/releases/tags/v0.1.0-dev.2",
      },
    ]);
  });

  test("rejects a draft or mutable release", async () => {
    for (const [release, message] of [
      [publishedRelease({ draft: true }), "draft Rootform releases are not installable"],
      [publishedRelease({ immutable: false }), "mutable Rootform releases are not installable"],
    ] as const) {
      await expect(resolveRelease("1.2.3", "", async () => json(release))).rejects.toThrow(message);
    }
  });

  test("does not make a request for latest or a version range", async () => {
    let requested = false;
    const fetcher: FetchLike = async () => {
      requested = true;
      return json(publishedRelease());
    };

    await expect(resolveRelease("latest", "", fetcher)).rejects.toThrow("exact semantic version");
    await expect(resolveRelease("^1.2.3", "", fetcher)).rejects.toThrow("exact semantic version");
    expect(requested).toBeFalse();
  });

  test("bounds release metadata and hides fetch exceptions", async () => {
    const oversized = "x".repeat(4 * 1024 * 1024 + 1);
    await expect(
      resolveRelease("1.2.3", "secret-token", async () => new Response(oversized)),
    ).rejects.toThrow("exceeds its size limit");

    await expect(
      resolveRelease("1.2.3", "secret-token", async () => {
        throw new Error("Bearer secret-token leaked by transport");
      }),
    ).rejects.not.toThrow("secret-token");
  });

  test("downloads exact asset bytes, checks size and applies a per-asset bound", async () => {
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
          3,
        ),
      ).rejects.toThrow("invalid size");

      await expect(
        downloadReleaseAsset(
          { id: 9, name: "changed", size: 4, url: "unused" },
          join(directory, "changed"),
          "",
          fetcher,
        ),
      ).rejects.toThrow("size changed");

      await expect(
        downloadReleaseAsset(
          { id: 10, name: "oversized", size: 3, url: "unused" },
          join(directory, "oversized"),
          "",
          async () => new Response("abcd"),
          3,
        ),
      ).rejects.toThrow("exceeds its size limit");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
