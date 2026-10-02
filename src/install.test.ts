import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FetchLike, Release, ReleaseAsset } from "./github.ts";
import {
  fileSha256,
  type InstallDependencies,
  installRootform,
  parseChecksums,
  platformAsset,
} from "./install.ts";

const version = "0.1.0-dev.1";
const archiveName = `rootform_${version}_linux_amd64.tar.gz`;

function sha256(contents: Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

type FixtureOptions = {
  archive?: Uint8Array;
  downloadedArchive?: Uint8Array;
  executable?: Uint8Array;
  checksumValue?: string;
  manifestChecksumValue?: string;
  manifestArchiveSha256?: string;
  manifestExecutableSha256?: string;
  manifestVersion?: string;
  manifestTag?: string;
  immutable?: boolean;
  draft?: boolean;
  digestOverrides?: Record<string, string | null>;
};

function releaseFixture(options: FixtureOptions = {}): {
  archive: Buffer;
  downloadedAssets: number[];
  executable: Buffer;
  fetcher: FetchLike;
  release: Release;
} {
  const archive = Buffer.from(options.archive ?? "synthetic archive bytes");
  const executable = Buffer.from(options.executable ?? "synthetic executable bytes");
  const archiveSha256 = options.manifestArchiveSha256 ?? sha256(archive);
  const manifest = Buffer.from(
    JSON.stringify({
      artifacts: [
        {
          archive_format: "tar.gz",
          architecture: "amd64",
          asset: archiveName,
          bytes: archive.byteLength,
          executable: "rootform",
          operating_system: "linux",
          raw_executable_sha256: options.manifestExecutableSha256 ?? sha256(executable),
          sha256: archiveSha256,
        },
      ],
      format_version: "1",
      product: {
        name: "rootform",
        tag: options.manifestTag ?? `v${version}`,
        version: options.manifestVersion ?? version,
      },
    }),
  );

  const checksums = Buffer.from(
    `${options.checksumValue ?? archiveSha256}  ${archiveName}\n${options.manifestChecksumValue ?? sha256(manifest)}  rootform_${version}_manifest.json\n`,
  );

  const content = new Map<number, Buffer>([
    [1, checksums],
    [2, manifest],
    [3, archive],
  ]);
  const digestOverrides = options.digestOverrides ?? {};
  const makeAsset = (id: number, name: string, body: Buffer): ReleaseAsset => ({
    digest: name in digestOverrides ? digestOverrides[name] : `sha256:${sha256(body)}`,
    id,
    name,
    size: body.byteLength,
    url: "unused",
  });
  const release: Release = {
    assets: [
      makeAsset(1, "SHA256SUMS", checksums),
      makeAsset(2, `rootform_${version}_manifest.json`, manifest),
      makeAsset(3, archiveName, archive),
    ],
    draft: options.draft ?? false,
    immutable: options.immutable ?? true,
    prerelease: true,
    tag_name: `v${version}`,
  };
  const downloadedAssets: number[] = [];
  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url.endsWith(`/releases/tags/v${version}`)) {
      return new Response(JSON.stringify(release), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const match = url.match(/\/releases\/assets\/(\d+)$/u);
    if (match?.[1]) {
      const id = Number(match[1]);
      downloadedAssets.push(id);
      const body =
        id === 3 && options.downloadedArchive
          ? Buffer.from(options.downloadedArchive)
          : content.get(id);
      if (!body) return new Response(null, { status: 404 });
      const responseBytes = new ArrayBuffer(body.byteLength);
      new Uint8Array(responseBytes).set(body);
      return new Response(responseBytes);
    }
    return new Response(null, { status: 404 });
  };
  return { archive, downloadedAssets, executable, fetcher, release };
}

type DependencyOptions = {
  cachedDirectory?: string;
  pathExecutable?: string;
  onVersion?: (binary: string) => void;
};

function makeDependencies(
  fixture: ReturnType<typeof releaseFixture>,
  options: DependencyOptions = {},
): {
  cleanup(): void;
  dependencies: InstallDependencies;
  observed: { addedPaths: string[]; executed: string[]; extractions: number; chmodded: string[] };
} {
  const cacheDirectories: string[] = [];
  const observed = {
    addedPaths: [] as string[],
    executed: [] as string[],
    extractions: 0,
    chmodded: [] as string[],
  };
  const dependencies: InstallDependencies = {
    addPath: (path) => observed.addedPaths.push(path),
    cacheDir: async (source) => {
      const cached = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
      cacheDirectories.push(cached);
      copyFileSync(join(source, "rootform"), join(cached, "rootform"));
      return cached;
    },
    chmod: (path) => observed.chmodded.push(path),
    executeVersion: (binary) => {
      observed.executed.push(binary);
      options.onVersion?.(binary);
      return `rootform ${version}`;
    },
    extractTar: async (archive, destination) => {
      observed.extractions += 1;
      if (!destination) throw new Error("missing extraction destination");
      expect(readFileSync(archive).toString("hex")).toBe(fixture.archive.toString("hex"));
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, "rootform"), fixture.executable);
      return destination;
    },
    extractZip: async () => {
      throw new Error("unexpected zip extraction");
    },
    find: () => options.cachedDirectory ?? "",
    findExecutable: () => options.pathExecutable ?? "",
  };
  return {
    cleanup: () => {
      for (const directory of cacheDirectories) rmSync(directory, { force: true, recursive: true });
    },
    dependencies,
    observed,
  };
}

function temporaryFile(contents: Uint8Array): { cleanup(): void; directory: string; file: string } {
  const directory = mkdtempSync(join(tmpdir(), "rootform-path-test-"));
  const file = join(directory, "rootform");
  writeFileSync(file, contents);
  return {
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    file,
  };
}

function installOptions(
  fixture: ReturnType<typeof releaseFixture>,
  dependencies: InstallDependencies,
) {
  return {
    architecture: "x64",
    dependencies,
    fetcher: fixture.fetcher,
    platform: "linux",
    token: "",
    version,
  };
}

describe("verified installer", () => {
  test("maps only supported runner targets to exact assets", () => {
    expect(platformAsset("1.2.3", "linux", "x64")).toEqual({
      archive: "rootform_1.2.3_linux_amd64.tar.gz",
      architecture: "amd64",
      executable: "rootform",
      operatingSystem: "linux",
    });
    expect(platformAsset("1.2.3", "win32", "x64").archive).toEndWith("windows_amd64.zip");
    expect(() => platformAsset("1.2.3", "win32", "arm64")).toThrow("does not provide");
    expect(() => platformAsset("1.2.3", "freebsd", "x64")).toThrow("does not provide");
  });

  test("accepts strict checksum lines only", () => {
    const digest = "a".repeat(64);
    expect(parseChecksums(`${digest}  rootform.tar.gz\n`).get("rootform.tar.gz")).toBe(digest);
    expect(() => parseChecksums(`${digest} *rootform.tar.gz\n`)).toThrow("invalid line");
    expect(() =>
      parseChecksums(`${digest}  rootform.tar.gz\n${digest}  rootform.tar.gz\n`),
    ).toThrow("duplicate");
  });

  test("verifies manifest-bound executable bytes before version execution and PATH", async () => {
    const fixture = releaseFixture();
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      onVersion: (binary) => {
        expect(fileSha256(binary)).toBe(sha256(fixture.executable));
        expect(observed.addedPaths).toEqual([]);
      },
    });
    try {
      const installation = await installRootform(installOptions(fixture, dependencies));
      expect(installation).toEqual({
        binary: join(observed.addedPaths[0] as string, "rootform"),
        sha256: sha256(fixture.executable),
        version,
      });
      expect(fixture.downloadedAssets).toEqual([1, 2, 3]);
      expect(observed.executed).toEqual([installation.binary]);
      expect(observed.extractions).toBe(1);
      expect(observed.addedPaths).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("rejects inconsistent manifest checksum even when API digests match", async () => {
    const fixture = releaseFixture({ manifestChecksumValue: "0".repeat(64) });
    const { cleanup, dependencies } = makeDependencies(fixture);
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "manifest checksum mismatch",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2]);
    } finally {
      cleanup();
    }
  });

  test("rejects a checksum/manifest mismatch before archive download or execution", async () => {
    const fixture = releaseFixture({ checksumValue: "0".repeat(64) });
    const { cleanup, dependencies, observed } = makeDependencies(fixture);
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "manifest checksum does not match",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
      expect(observed.extractions).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("rejects changed archive bytes before extraction, execution or PATH", async () => {
    const changedArchive = Buffer.from("synthetic archive bytes");
    changedArchive[0] = (changedArchive[0] ?? 0) ^ 1;
    const fixture = releaseFixture({ downloadedArchive: changedArchive });
    const { cleanup, dependencies, observed } = makeDependencies(fixture);
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        `GitHub digest mismatch for ${archiveName}`,
      );
      expect(fixture.downloadedAssets).toEqual([1, 2, 3]);
      expect(observed.extractions).toBe(0);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("rejects an invalid release asset digest before cache reuse", async () => {
    const fixture = releaseFixture({ digestOverrides: { SHA256SUMS: null } });
    const cache = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
    writeFileSync(join(cache, "rootform"), fixture.executable);
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      cachedDirectory: cache,
    });
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "no valid SHA-256 digest",
      );
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
      expect(fixture.downloadedAssets).toEqual([1, 2]);
    } finally {
      cleanup();
      rmSync(cache, { force: true, recursive: true });
    }
  });

  test("reuses a complete verified tool-cache entry without downloading its archive", async () => {
    const fixture = releaseFixture();
    const cache = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
    writeFileSync(join(cache, "rootform"), fixture.executable);
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      cachedDirectory: cache,
      onVersion: (binary) => expect(fileSha256(binary)).toBe(sha256(fixture.executable)),
    });
    try {
      const installation = await installRootform(installOptions(fixture, dependencies));
      expect(installation.binary).toBe(join(cache, "rootform"));
      expect(installation.sha256).toBe(sha256(fixture.executable));
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([installation.binary]);
      expect(observed.addedPaths).toEqual([cache]);
      expect(observed.extractions).toBe(0);
    } finally {
      cleanup();
      rmSync(cache, { force: true, recursive: true });
    }
  });

  test("fails closed on a tampered cached executable without executing or downloading the archive", async () => {
    const fixture = releaseFixture();
    const cache = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
    writeFileSync(join(cache, "rootform"), "tampered cached executable");
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      cachedDirectory: cache,
    });
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "cached Rootform executable digest mismatch",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
      expect(observed.extractions).toBe(0);
    } finally {
      cleanup();
      rmSync(cache, { force: true, recursive: true });
    }
  });

  test("fails on an incomplete cached directory without executing or falling back", async () => {
    const fixture = releaseFixture();
    const cache = mkdtempSync(join(tmpdir(), "rootform-cache-test-"));
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      cachedDirectory: cache,
    });
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "cached Rootform executable is missing",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
      expect(observed.extractions).toBe(0);
    } finally {
      cleanup();
      rmSync(cache, { force: true, recursive: true });
    }
  });

  test("reuses matching regular PATH bytes without downloading the archive", async () => {
    const fixture = releaseFixture();
    const pathFile = temporaryFile(fixture.executable);
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      pathExecutable: pathFile.file,
    });
    try {
      const installation = await installRootform(installOptions(fixture, dependencies));
      expect(installation).toEqual({
        binary: pathFile.file,
        sha256: sha256(fixture.executable),
        version,
      });
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([pathFile.file]);
      expect(observed.addedPaths).toEqual([pathFile.directory]);
      expect(observed.extractions).toBe(0);
    } finally {
      cleanup();
      pathFile.cleanup();
    }
  });

  test("never executes an older PATH binary and installs the requested release", async () => {
    const fixture = releaseFixture();
    const oldPath = temporaryFile(Buffer.from("older executable bytes"));
    const { cleanup, dependencies, observed } = makeDependencies(fixture, {
      pathExecutable: oldPath.file,
    });
    try {
      const installation = await installRootform(installOptions(fixture, dependencies));
      expect(fixture.downloadedAssets).toEqual([1, 2, 3]);
      expect(observed.executed).toEqual([installation.binary]);
      expect(observed.executed).not.toContain(oldPath.file);
      expect(installation.sha256).toBe(sha256(fixture.executable));
      expect(observed.addedPaths).toEqual([dirname(installation.binary)]);
    } finally {
      cleanup();
      oldPath.cleanup();
    }
  });

  test("rejects manifest identity or executable hash drift before version execution", async () => {
    const fixture = releaseFixture({
      manifestExecutableSha256: "f".repeat(64),
      manifestVersion: "0.1.0-dev.2",
    });
    const { cleanup, dependencies, observed } = makeDependencies(fixture);
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "manifest identity does not match",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2]);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("rejects extracted executable bytes that differ from the release manifest", async () => {
    const fixture = releaseFixture({ manifestExecutableSha256: "f".repeat(64) });
    const { cleanup, dependencies, observed } = makeDependencies(fixture);
    try {
      await expect(installRootform(installOptions(fixture, dependencies))).rejects.toThrow(
        "extracted Rootform executable digest mismatch",
      );
      expect(fixture.downloadedAssets).toEqual([1, 2, 3]);
      expect(observed.executed).toEqual([]);
      expect(observed.addedPaths).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
