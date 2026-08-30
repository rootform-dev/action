import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike, Release } from "./github.ts";
import {
  fileSha256,
  type InstallDependencies,
  installRootform,
  parseChecksums,
  platformAsset,
} from "./install.ts";

function sha256(contents: Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function releaseFetcher(options: {
  archive: Uint8Array;
  archiveName: string;
  checksumDigest?: string;
}): FetchLike {
  const expected = options.checksumDigest ?? sha256(options.archive);
  const checksums = Buffer.from(`${expected}  ${options.archiveName}\n`);
  const release: Release = {
    assets: [
      {
        digest: `sha256:${sha256(checksums)}`,
        id: 1,
        name: "SHA256SUMS",
        size: checksums.byteLength,
        url: "unused",
      },
      {
        digest: `sha256:${sha256(options.archive)}`,
        id: 2,
        name: options.archiveName,
        size: options.archive.byteLength,
        url: "unused",
      },
    ],
    draft: false,
    prerelease: true,
    tag_name: "v0.1.0-dev.1",
  };
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/releases/tags/v0.1.0-dev.1")) {
      return new Response(JSON.stringify(release), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/releases/assets/1")) return new Response(checksums);
    if (url.endsWith("/releases/assets/2")) return new Response(options.archive);
    return new Response(null, { status: 404 });
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

  test("verifies archive, extracted version, and cache before PATH", async () => {
    const extracted = mkdtempSync(join(tmpdir(), "rootform-install-test-"));
    const archive = Buffer.from("synthetic archive");
    const binary = join(extracted, "rootform");
    const addedPaths: string[] = [];
    let chmodded = "";
    const dependencies: InstallDependencies = {
      addPath: (path) => addedPaths.push(path),
      cacheDir: async (source) => source,
      chmod: (path) => {
        chmodded = path;
      },
      executeVersion: () => "rootform 0.1.0-dev.1",
      extractTar: async (path) => {
        expect(readFileSync(path)).toEqual(archive);
        writeFileSync(binary, "verified executable");
        return extracted;
      },
      extractZip: async () => {
        throw new Error("unexpected zip extraction");
      },
      find: () => "",
    };

    try {
      const installation = await installRootform({
        architecture: "x64",
        dependencies,
        fetcher: releaseFetcher({
          archive,
          archiveName: "rootform_0.1.0-dev.1_linux_amd64.tar.gz",
        }),
        platform: "linux",
        token: "",
        version: "0.1.0-dev.1",
      });
      expect(installation).toEqual({
        binary,
        sha256: fileSha256(binary),
        version: "0.1.0-dev.1",
      });
      expect(chmodded).toBe(binary);
      expect(addedPaths).toEqual([extracted]);
    } finally {
      rmSync(extracted, { force: true, recursive: true });
    }
  });

  test("rejects checksum corruption before extraction or PATH mutation", async () => {
    const archive = Buffer.from("synthetic archive");
    let touched = false;
    const dependencies: InstallDependencies = {
      addPath: () => {
        touched = true;
      },
      cacheDir: async () => "unused",
      chmod: () => {
        touched = true;
      },
      executeVersion: () => "rootform 0.1.0-dev.1",
      extractTar: async () => {
        touched = true;
        return "unused";
      },
      extractZip: async () => "unused",
      find: () => "",
    };

    await expect(
      installRootform({
        architecture: "x64",
        dependencies,
        fetcher: releaseFetcher({
          archive,
          archiveName: "rootform_0.1.0-dev.1_linux_amd64.tar.gz",
          checksumDigest: "0".repeat(64),
        }),
        platform: "linux",
        token: "",
        version: "0.1.0-dev.1",
      }),
    ).rejects.toThrow("checksum mismatch");
    expect(touched).toBeFalse();
  });
});
