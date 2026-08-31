import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
import * as toolCache from "@actions/tool-cache";
import { cliEnvironment } from "./environment.ts";
import {
  downloadReleaseAsset,
  type FetchLike,
  type ReleaseAsset,
  resolveRelease,
} from "./github.ts";

export type PlatformAsset = {
  archive: string;
  architecture: "amd64" | "arm64";
  executable: "rootform" | "rootform.exe";
  operatingSystem: "darwin" | "linux" | "windows";
};

export type Installation = {
  binary: string;
  sha256: string;
  version: string;
};

export type InstallDependencies = {
  addPath(path: string): void;
  cacheDir(
    sourceDirectory: string,
    tool: string,
    version: string,
    architecture: string,
  ): Promise<string>;
  chmod(path: string): void;
  executeVersion(binary: string): string;
  extractTar(archive: string): Promise<string>;
  extractZip(archive: string): Promise<string>;
  find(tool: string, version: string, architecture: string): string;
};

const defaultDependencies: InstallDependencies = {
  addPath: core.addPath,
  cacheDir: toolCache.cacheDir,
  chmod: (path) => chmodSync(path, 0o755),
  executeVersion: (binary) =>
    execFileSync(binary, ["version"], {
      encoding: "utf8",
      env: cliEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  extractTar: toolCache.extractTar,
  extractZip: toolCache.extractZip,
  find: toolCache.find,
};

export function platformAsset(
  version: string,
  platform: string = process.platform,
  architecture: string = process.arch,
): PlatformAsset {
  const operatingSystems = { darwin: "darwin", linux: "linux", win32: "windows" } as const;
  const architectures = { arm64: "arm64", x64: "amd64" } as const;
  const operatingSystem = operatingSystems[platform as keyof typeof operatingSystems];
  const resolvedArchitecture = architectures[architecture as keyof typeof architectures];
  if (
    !operatingSystem ||
    !resolvedArchitecture ||
    (operatingSystem === "windows" && resolvedArchitecture === "arm64")
  ) {
    throw new Error(`Rootform does not provide a release for ${platform}/${architecture}`);
  }
  const extension = operatingSystem === "windows" ? "zip" : "tar.gz";
  return {
    archive: `rootform_${version}_${operatingSystem}_${resolvedArchitecture}.${extension}`,
    architecture: resolvedArchitecture,
    executable: operatingSystem === "windows" ? "rootform.exe" : "rootform",
    operatingSystem,
  };
}

export function parseChecksums(contents: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    if (!line) continue;
    const match = line.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/u);
    if (!match) throw new Error("SHA256SUMS contains an invalid line");
    const [, digest, name] = match;
    if (!digest || !name || checksums.has(name))
      throw new Error("SHA256SUMS contains duplicate asset");
    checksums.set(name, digest);
  }
  if (checksums.size === 0) throw new Error("SHA256SUMS contains no assets");
  return checksums;
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function exactAsset(assets: ReleaseAsset[], name: string): ReleaseAsset {
  const matches = assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) throw new Error(`Rootform release must contain exactly one ${name}`);
  return matches[0] as ReleaseAsset;
}

function verifyDigest(asset: ReleaseAsset, actual: string): void {
  if (asset.digest && asset.digest !== `sha256:${actual}`) {
    throw new Error(`GitHub digest mismatch for ${asset.name}`);
  }
}

function verifyReportedVersion(
  binary: string,
  version: string,
  dependencies: InstallDependencies,
): void {
  let reported: string;
  try {
    reported = dependencies.executeVersion(binary);
  } catch {
    throw new Error("Rootform binary version check failed");
  }
  if (reported !== `rootform ${version}`) {
    throw new Error(`Rootform binary reports unexpected version: ${reported}`);
  }
}

export async function installRootform(options: {
  architecture?: string;
  dependencies?: InstallDependencies;
  platform?: string;
  token: string;
  version: string;
  fetcher?: FetchLike;
}): Promise<Installation> {
  const fetcher = options.fetcher ?? fetch;
  const dependencies = options.dependencies ?? defaultDependencies;
  const { release, version } = await resolveRelease(options.version, options.token, fetcher);
  const target = platformAsset(version, options.platform, options.architecture);
  const cached = dependencies.find("rootform", version, target.architecture);
  if (cached) {
    const binary = join(cached, target.executable);
    if (!existsSync(binary)) throw new Error("cached Rootform installation is incomplete");
    verifyReportedVersion(binary, version, dependencies);
    dependencies.addPath(cached);
    return { binary, sha256: fileSha256(binary), version };
  }

  const archiveAsset = exactAsset(release.assets, target.archive);
  const checksumAsset = exactAsset(release.assets, "SHA256SUMS");
  const temporary = mkdtempSync(join(tmpdir(), "rootform-action-"));
  try {
    const archivePath = join(temporary, target.archive);
    const checksumPath = join(temporary, "SHA256SUMS");
    await downloadReleaseAsset(checksumAsset, checksumPath, options.token, fetcher);
    await downloadReleaseAsset(archiveAsset, archivePath, options.token, fetcher);
    verifyDigest(checksumAsset, fileSha256(checksumPath));
    const actual = fileSha256(archivePath);
    verifyDigest(archiveAsset, actual);
    const expected = parseChecksums(readFileSync(checksumPath, "utf8")).get(target.archive);
    if (!expected || expected !== actual)
      throw new Error(`checksum mismatch for ${target.archive}`);

    const extracted =
      target.operatingSystem === "windows"
        ? await dependencies.extractZip(archivePath)
        : await dependencies.extractTar(archivePath);
    const binary = join(extracted, target.executable);
    if (!existsSync(binary)) throw new Error(`Rootform archive omits ${target.executable}`);
    if (target.operatingSystem !== "windows") dependencies.chmod(binary);
    verifyReportedVersion(binary, version, dependencies);

    const cachedDirectory = await dependencies.cacheDir(
      extracted,
      "rootform",
      version,
      target.architecture,
    );
    dependencies.addPath(cachedDirectory);
    return {
      binary: join(cachedDirectory, target.executable),
      sha256: fileSha256(join(cachedDirectory, target.executable)),
      version,
    };
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}
