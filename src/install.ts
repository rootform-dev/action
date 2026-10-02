import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import * as core from "@actions/core";
import * as toolCache from "@actions/tool-cache";
import { cliEnvironment } from "./environment.ts";
import {
  downloadReleaseAsset,
  type FetchLike,
  type Release,
  type ReleaseAsset,
  resolveRelease,
} from "./github.ts";

const maxChecksumsBytes = 1024 * 1024;
const maxManifestBytes = 4 * 1024 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/u;

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
  extractTar(archive: string, destination?: string): Promise<string>;
  extractZip(archive: string, destination?: string): Promise<string>;
  find(tool: string, version: string, architecture: string): string;
  findExecutable?(name: string): string;
};

function findExecutableInPath(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || process.cwd(), name);
    if (isRegularFile(candidate)) return candidate;
  }
  return "";
}

const defaultDependencies: InstallDependencies = {
  addPath: core.addPath,
  cacheDir: toolCache.cacheDir,
  chmod: (path) => chmodSync(path, 0o755),
  executeVersion: (binary) =>
    execFileSync(binary, ["version"], {
      encoding: "utf8",
      env: cliEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    }).trim(),
  extractTar: toolCache.extractTar,
  extractZip: toolCache.extractZip,
  find: toolCache.find,
  findExecutable: findExecutableInPath,
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
    const match = line.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9._+-]+)$/u);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isRegularDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function requireApiDigest(asset: ReleaseAsset, actual: string): void {
  if (!sha256Pattern.test(actual)) throw new Error(`invalid SHA-256 for ${asset.name}`);
  if (typeof asset.digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(asset.digest)) {
    throw new Error(`GitHub release asset has no valid SHA-256 digest: ${asset.name}`);
  }
  if (asset.digest !== `sha256:${actual}`) {
    throw new Error(`GitHub digest mismatch for ${asset.name}`);
  }
}

function requireVerifiedFile(path: string, expected: string, label: string): string {
  if (!isRegularFile(path))
    throw new Error(`${label} Rootform executable is missing or not a regular file`);
  const actual = fileSha256(path);
  if (actual !== expected) throw new Error(`${label} Rootform executable digest mismatch`);
  return actual;
}

function matchesVerifiedFile(path: string, expected: string): boolean {
  if (!isRegularFile(path)) return false;
  try {
    return fileSha256(path) === expected;
  } catch {
    return false;
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
    throw new Error(`Rootform binary version check failed for ${version}`);
  }
  if (reported !== `rootform ${version}`) {
    throw new Error(`Rootform binary version does not match requested version ${version}`);
  }
}

function manifestExecutableDigest(
  path: string,
  version: string,
  target: PlatformAsset,
  archiveAsset: ReleaseAsset,
  checksums: Map<string, string>,
): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error("Rootform release manifest is invalid JSON");
  }
  if (!isRecord(manifest) || manifest.format_version !== "1") {
    throw new Error("Rootform release manifest has an unsupported format");
  }
  const product = manifest.product;
  if (
    !isRecord(product) ||
    product.name !== "rootform" ||
    product.version !== version ||
    product.tag !== `v${version}`
  ) {
    throw new Error(`Rootform release manifest identity does not match ${version}`);
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error("Rootform release manifest artifacts are invalid");
  }
  const matches = manifest.artifacts.filter(
    (artifact): artifact is Record<string, unknown> =>
      isRecord(artifact) && artifact.asset === target.archive,
  );
  if (matches.length !== 1) {
    throw new Error(`Rootform release manifest must contain exactly one ${target.archive}`);
  }
  const artifact = matches[0];
  if (!artifact) throw new Error(`Rootform release manifest is missing ${target.archive}`);
  if (
    artifact.operating_system !== target.operatingSystem ||
    artifact.architecture !== target.architecture ||
    artifact.executable !== target.executable ||
    artifact.archive_format !== (target.operatingSystem === "windows" ? "zip" : "tar.gz") ||
    artifact.bytes !== archiveAsset.size ||
    typeof artifact.sha256 !== "string" ||
    !sha256Pattern.test(artifact.sha256) ||
    typeof artifact.raw_executable_sha256 !== "string" ||
    !sha256Pattern.test(artifact.raw_executable_sha256)
  ) {
    throw new Error(`Rootform release manifest artifact does not match ${target.archive}`);
  }
  const checksum = checksums.get(target.archive);
  if (!checksum || checksum !== artifact.sha256) {
    throw new Error(`Rootform release manifest checksum does not match ${target.archive}`);
  }
  requireApiDigest(archiveAsset, artifact.sha256);
  return artifact.raw_executable_sha256;
}

async function verifiedReleaseMetadata(
  release: Release,
  version: string,
  target: PlatformAsset,
  temporary: string,
  token: string,
  fetcher: FetchLike,
): Promise<{ archiveAsset: ReleaseAsset; executableSha256: string }> {
  const archiveAsset = exactAsset(release.assets, target.archive);
  const checksumAsset = exactAsset(release.assets, "SHA256SUMS");
  const manifestAsset = exactAsset(release.assets, `rootform_${version}_manifest.json`);
  const checksumsPath = join(temporary, "SHA256SUMS");
  const manifestPath = join(temporary, "rootform_manifest.json");

  await downloadReleaseAsset(checksumAsset, checksumsPath, token, fetcher, maxChecksumsBytes);
  await downloadReleaseAsset(manifestAsset, manifestPath, token, fetcher, maxManifestBytes);
  requireApiDigest(checksumAsset, fileSha256(checksumsPath));
  requireApiDigest(manifestAsset, fileSha256(manifestPath));

  const checksums = parseChecksums(readFileSync(checksumsPath, "utf8"));
  if (checksums.get(manifestAsset.name) !== fileSha256(manifestPath)) {
    throw new Error("Rootform release manifest checksum mismatch");
  }
  return {
    archiveAsset,
    executableSha256: manifestExecutableDigest(
      manifestPath,
      version,
      target,
      archiveAsset,
      checksums,
    ),
  };
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
  const temporary = mkdtempSync(join(tmpdir(), "rootform-action-"));
  try {
    const { archiveAsset, executableSha256 } = await verifiedReleaseMetadata(
      release,
      version,
      target,
      temporary,
      options.token,
      fetcher,
    );

    const cached = dependencies.find("rootform", version, target.architecture);
    if (cached) {
      if (!isRegularDirectory(cached))
        throw new Error("cached Rootform installation is incomplete");
      const binary = join(cached, target.executable);
      const sha256 = requireVerifiedFile(binary, executableSha256, "cached");
      verifyReportedVersion(binary, version, dependencies);
      dependencies.addPath(cached);
      return { binary, sha256, version };
    }

    const pathExecutable = dependencies.findExecutable?.(target.executable) ?? "";
    if (pathExecutable && matchesVerifiedFile(pathExecutable, executableSha256)) {
      const sha256 = requireVerifiedFile(pathExecutable, executableSha256, "PATH");
      verifyReportedVersion(pathExecutable, version, dependencies);
      dependencies.addPath(dirname(pathExecutable));
      return { binary: pathExecutable, sha256, version };
    }

    const archivePath = join(temporary, target.archive);
    await downloadReleaseAsset(archiveAsset, archivePath, options.token, fetcher);
    const archiveSha256 = fileSha256(archivePath);
    requireApiDigest(archiveAsset, archiveSha256);

    const extractionDirectory = join(temporary, "extracted");
    mkdirSync(extractionDirectory);
    const extracted =
      target.operatingSystem === "windows"
        ? await dependencies.extractZip(archivePath, extractionDirectory)
        : await dependencies.extractTar(archivePath, extractionDirectory);
    if (!isRegularDirectory(extracted)) throw new Error("Rootform archive extraction failed");
    const extractedBinary = join(extracted, target.executable);
    requireVerifiedFile(extractedBinary, executableSha256, "extracted");
    if (target.operatingSystem !== "windows") dependencies.chmod(extractedBinary);

    const cachedDirectory = await dependencies.cacheDir(
      extracted,
      "rootform",
      version,
      target.architecture,
    );
    if (!isRegularDirectory(cachedDirectory)) {
      throw new Error("Rootform tool cache did not return a complete installation");
    }
    const binary = join(cachedDirectory, target.executable);
    const sha256 = requireVerifiedFile(binary, executableSha256, "cached");
    verifyReportedVersion(binary, version, dependencies);
    dependencies.addPath(cachedDirectory);
    return { binary, sha256, version };
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}
