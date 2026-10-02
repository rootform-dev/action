import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CACHE_VERSION = "rootform-external-packages-v2";

/**
 * Only installed external selections are cached. Supplied Dialects and RF
 * Vocabulary stay inside the verified Rootform binary; linked artifacts,
 * temporary files, and other derived cache state stay outside this boundary.
 */
export const CACHED_HOME_DIRECTORIES = ["dialects", "policy-packs"] as const;

export const EXCLUDED_HOME_DIRECTORIES = ["cache", "tmp"] as const;

export type CacheKeys = {
  primary: string;
  restore: string[];
};

export function cachePaths(home: string): string[] {
  return CACHED_HOME_DIRECTORIES.map((directory) => join(home, directory));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Exact lock bytes identify immutable source payload. Execution mode does
 * not change those bytes: an online warm-up must remain reusable offline.
 * Never restore another lock's store through a coarse prefix. */
export function cacheKeys(options: {
  lockPath: string;
  platform: string;
  version: string;
}): CacheKeys {
  const scope = `${CACHE_VERSION}-${options.platform}-${options.version}`;
  const lock = digest(readFileSync(options.lockPath, "utf8"));
  return { primary: `${scope}-lock-${lock}`, restore: [] };
}

export type CacheClient = {
  restore(paths: string[], primary: string, restore: string[]): Promise<string | undefined>;
  save(paths: string[], primary: string): Promise<void>;
};

export type CacheOutcome = {
  matchedKey?: string;
  restored: boolean;
};

/**
 * A restored entry is a starting point, never an authority: preparation always
 * runs afterwards so the CLI re-verifies every selected package by digest.
 */
export async function restoreDependencyCache(options: {
  client: CacheClient;
  home: string;
  keys: CacheKeys;
  warn?(message: string): void;
}): Promise<CacheOutcome> {
  try {
    const matchedKey = await options.client.restore(
      cachePaths(options.home),
      options.keys.primary,
      options.keys.restore,
    );
    return { matchedKey, restored: Boolean(matchedKey) };
  } catch {
    options.warn?.("Rootform dependency cache could not be restored; continuing without it.");
    return { restored: false };
  }
}

export async function saveDependencyCache(options: {
  client: CacheClient;
  home: string;
  keys: CacheKeys;
  outcome: CacheOutcome;
  warn?(message: string): void;
}): Promise<boolean> {
  if (options.outcome.matchedKey === options.keys.primary) return false;
  const paths = cachePaths(options.home);
  if (!paths.some((path) => existsSync(path))) return false;
  try {
    await options.client.save(paths, options.keys.primary);
    return true;
  } catch {
    options.warn?.("Rootform dependency cache could not be saved; continuing without it.");
    return false;
  }
}
