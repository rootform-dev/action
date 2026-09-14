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
  restoreDependencyCache,
  saveDependencyCache,
} from "./cache.ts";

function workspaceWithLock(contents: string): { directory: string; lockPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
  const lockPath = join(directory, "rootform.lock");
  writeFileSync(lockPath, contents);
  return { directory, lockPath };
}

describe("external dependency cache", () => {
  test("caches only immutable Dialect and Policy Pack payload", () => {
    const paths = cachePaths("/runner/temp/rootform-home");
    expect(paths).toEqual([
      "/runner/temp/rootform-home/dialects",
      "/runner/temp/rootform-home/policy-packs",
    ]);

    for (const excluded of EXCLUDED_HOME_DIRECTORIES) {
      expect(CACHED_HOME_DIRECTORIES).not.toContain(excluded);
      expect(paths.some((path) => path.split("/").includes(excluded))).toBeFalse();
    }

    const locked = workspaceWithLock(
      '{"format_version":"1","dialects":[],"policy_packs":[],"excluded_owners":[],"replacements":[]}\n',
    );
    try {
      const keys = cacheKeys({
        lockPath: locked.lockPath,
        mode: "locked",
        platform: "linux-x64",
        runId: "42",
        version: "0.1.0",
      });
      expect(keys.primary).toStartWith(
        "rootform-external-packages-v1-linux-x64-0.1.0-locked-lock-",
      );
      expect(keys.primary).toMatch(/-lock-[0-9a-f]{64}$/u);
      expect(keys.restore).toEqual([
        "rootform-external-packages-v1-linux-x64-0.1.0-locked-lock-",
        "rootform-external-packages-v1-linux-x64-0.1.0-locked-",
      ]);

      // A different lock must never reuse the same entry.
      writeFileSync(
        locked.lockPath,
        '{"format_version":"1","dialects":[],"policy_packs":[],"excluded_owners":["aws"],"replacements":[]}\n',
      );
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

  test("keeps an unlocked key coarse", () => {
    const keys = cacheKeys({
      lockPath: "/workspace/absent/rootform.lock",
      mode: "default",
      platform: "linux-arm64",
      runId: "981",
      version: "0.1.0",
    });
    expect(keys.primary).toBe("rootform-external-packages-v1-linux-arm64-0.1.0-default-open-981");
    expect(keys.restore).toEqual([
      "rootform-external-packages-v1-linux-arm64-0.1.0-default-open-",
      "rootform-external-packages-v1-linux-arm64-0.1.0-default-",
    ]);
    // An untrusted run identifier never reaches the key verbatim.
    expect(
      cacheKeys({ mode: "default", platform: "linux-x64", runId: "../../etc", version: "0.1.0" })
        .primary,
    ).toBe("rootform-external-packages-v1-linux-x64-0.1.0-default-open-0");
  });

  test("never lets a restored entry replace verification", async () => {
    const home = mkdtempSync(join(tmpdir(), "rootform-cache-home-"));
    mkdirSync(join(home, "dialects"), { recursive: true });
    mkdirSync(join(home, "policy-packs"), { recursive: true });
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
      const outcome = await restoreDependencyCache({ client, home, keys });
      expect(outcome.restored).toBeTrue();
      expect(restoreCalls).toHaveLength(1);
      expect(restoreCalls[0]?.paths).toEqual(cachePaths(home));

      // A hit on a restore prefix still saves the exact key for the next run.
      expect(await saveDependencyCache({ client, home, keys, outcome })).toBeTrue();
      expect(saveCalls[0]?.primary).toBe(keys.primary);

      // An exact hit needs no rewrite.
      expect(
        await saveDependencyCache({
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
    const home = mkdtempSync(join(tmpdir(), "rootform-failing-cache-home-"));
    mkdirSync(join(home, "dialects"));
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
    try {
      const outcome = await restoreDependencyCache({
        client: failing,
        home,
        keys,
        warn: (message) => warnings.push(message),
      });
      expect(outcome).toEqual({ restored: false });
      expect(
        await saveDependencyCache({
          client: failing,
          home,
          keys,
          outcome,
          warn: (message) => warnings.push(message),
        }),
      ).toBeFalse();
      expect(warnings).toEqual([
        "Rootform dependency cache could not be restored; continuing without it.",
        "Rootform dependency cache could not be saved; continuing without it.",
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  test("skips an empty external package cache without warning", async () => {
    const home = mkdtempSync(join(tmpdir(), "rootform-empty-cache-home-"));
    const warnings: string[] = [];
    let saved = false;
    try {
      expect(
        await saveDependencyCache({
          client: {
            restore: async () => undefined,
            save: async () => {
              saved = true;
            },
          },
          home,
          keys: cacheKeys({
            mode: "default",
            platform: "linux-x64",
            runId: "7",
            version: "0.1.0",
          }),
          outcome: { restored: false },
          warn: (message) => warnings.push(message),
        }),
      ).toBeFalse();
      expect(saved).toBeFalse();
      expect(warnings).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
