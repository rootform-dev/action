import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHED_HOME_DIRECTORIES,
  type CacheClient,
  cacheKeys,
  cachePaths,
  EXCLUDED_HOME_DIRECTORIES,
  restoreDialectCache,
  saveDialectCache,
} from "./cache.ts";

function workspaceWithLock(contents: string): { directory: string; lockPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
  const lockPath = join(directory, "rootform.lock");
  writeFileSync(lockPath, contents);
  return { directory, lockPath };
}

describe("dialect cache", () => {
  test("caches only immutable dialect payload", () => {
    const paths = cachePaths("/runner/temp/rootform-home");
    expect(paths).toEqual([
      "/runner/temp/rootform-home/dialects",
      "/runner/temp/rootform-home/cache/blobs",
    ]);

    // The official index is mutable selection state. Sharing it between two
    // revisions of a pull request would let one revision decide what the other
    // resolves, so it must never appear in a cached path.
    for (const excluded of EXCLUDED_HOME_DIRECTORIES) {
      expect(CACHED_HOME_DIRECTORIES).not.toContain(excluded);
      expect(paths.some((path) => path.split("/").includes(excluded))).toBeFalse();
    }

    const locked = workspaceWithLock('{"format_version":"1","entries":[]}\n');
    try {
      const keys = cacheKeys({
        lockPath: locked.lockPath,
        mode: "locked",
        platform: "linux-x64",
        runId: "42",
        version: "0.1.0",
      });
      expect(keys.primary).toStartWith("rootform-dialects-v1-linux-x64-0.1.0-locked-lock-");
      expect(keys.primary).toMatch(/-lock-[0-9a-f]{64}$/u);
      expect(keys.restore).toEqual([
        "rootform-dialects-v1-linux-x64-0.1.0-locked-lock-",
        "rootform-dialects-v1-linux-x64-0.1.0-locked-",
      ]);

      // A different lock must never reuse the same entry.
      writeFileSync(locked.lockPath, '{"format_version":"1","entries":[{"name":"aws"}]}\n');
      const changed = cacheKeys({
        lockPath: locked.lockPath,
        mode: "locked",
        platform: "linux-x64",
        runId: "42",
        version: "0.1.0",
      });
      expect(changed.primary).not.toBe(keys.primary);
    } finally {
      rmSync(locked.directory, { force: true, recursive: true });
    }
  });

  test("keeps an unlocked key coarse and free of provider names", () => {
    const keys = cacheKeys({
      lockPath: "/workspace/absent/rootform.lock",
      mode: "default",
      platform: "linux-arm64",
      runId: "981",
      version: "0.1.0",
    });
    expect(keys.primary).toBe("rootform-dialects-v1-linux-arm64-0.1.0-default-open-981");
    expect(keys.restore).toEqual([
      "rootform-dialects-v1-linux-arm64-0.1.0-default-open-",
      "rootform-dialects-v1-linux-arm64-0.1.0-default-",
    ]);
    for (const provider of ["aws", "google", "azurerm", "kubernetes"]) {
      expect(keys.primary).not.toContain(provider);
      expect(keys.restore.join(" ")).not.toContain(provider);
    }
    // An untrusted run identifier never reaches the key verbatim.
    expect(
      cacheKeys({ mode: "default", platform: "linux-x64", runId: "../../etc", version: "0.1.0" })
        .primary,
    ).toBe("rootform-dialects-v1-linux-x64-0.1.0-default-open-0");
  });

  test("never lets a restored entry replace verification", async () => {
    const home = mkdtempSync(join(tmpdir(), "rootform-cache-home-"));
    mkdirSync(join(home, "dialects"), { recursive: true });
    const keys = cacheKeys({
      mode: "default",
      platform: "linux-x64",
      runId: "7",
      version: "0.1.0",
    });
    const restoreCalls: Array<{ paths: string[]; primary: string; restore: string[] }> = [];
    const saveCalls: Array<{ paths: string[]; primary: string }> = [];
    const client: CacheClient = {
      restore: async (paths, primary, restore) => {
        restoreCalls.push({ paths, primary, restore });
        return restore[0];
      },
      save: async (paths, primary) => {
        saveCalls.push({ paths, primary });
      },
    };

    try {
      const outcome = await restoreDialectCache({ client, home, keys });
      expect(outcome.restored).toBeTrue();
      expect(restoreCalls).toHaveLength(1);
      expect(restoreCalls[0]?.paths).toEqual(cachePaths(home));

      // A hit on a restore prefix still saves the exact key for the next run.
      expect(await saveDialectCache({ client, home, keys, outcome })).toBeTrue();
      expect(saveCalls[0]?.primary).toBe(keys.primary);

      // An exact hit needs no rewrite.
      expect(
        await saveDialectCache({
          client,
          home,
          keys,
          outcome: { matchedKey: keys.primary, restored: true },
        }),
      ).toBeFalse();
      expect(saveCalls).toHaveLength(1);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  test("treats a cache failure as a slower run, never as a different result", async () => {
    const home = "/runner/temp/rootform-home";
    const keys = cacheKeys({
      mode: "default",
      platform: "linux-x64",
      runId: "7",
      version: "0.1.0",
    });
    const warnings: string[] = [];
    const failing: CacheClient = {
      restore: async () => {
        throw new Error("cache service unavailable");
      },
      save: async () => {
        throw new Error("cache service unavailable");
      },
    };
    const outcome = await restoreDialectCache({
      client: failing,
      home,
      keys,
      warn: (message) => warnings.push(message),
    });
    expect(outcome).toEqual({ restored: false });
    expect(
      await saveDialectCache({
        client: failing,
        home,
        keys,
        outcome,
        warn: (message) => warnings.push(message),
      }),
    ).toBeFalse();
    expect(warnings).toEqual([
      "Rootform dialect cache could not be restored; continuing without it.",
      "Rootform dialect cache could not be saved; continuing without it.",
    ]);
  });
});
