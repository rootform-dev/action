import { writeFileSync } from "node:fs";

export const releaseRepository = "rootform-dev/rootform";
const apiVersion = "2026-03-10";
const userAgent = "rootform-action";
const maxReleaseMetadataBytes = 4 * 1024 * 1024;
const maxReleaseAssetBytes = 512 * 1024 * 1024;

export type ReleaseAsset = {
  id: number;
  name: string;
  size: number;
  digest?: string | null;
  url: string;
};

export type Release = {
  tag_name: string;
  draft: boolean;
  immutable: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function requestHeaders(token: string, accept = "application/vnd.github+json"): Headers {
  const headers = new Headers({
    Accept: accept,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": apiVersion,
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function request(
  path: string,
  token: string,
  fetcher: FetchLike,
  accept?: string,
): Promise<Response> {
  try {
    return await fetcher(`https://api.github.com${path}`, {
      headers: requestHeaders(token, accept),
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(`GitHub request failed for ${path}`);
  }
}

async function boundedBody(response: Response, limit: number, label: string): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeds its size limit`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    let body: Buffer;
    try {
      body = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new Error(`${label} download failed`);
    }
    if (body.byteLength > limit) throw new Error(`${label} exceeds its size limit`);
    return body;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read().catch(() => {
        throw new Error(`${label} download failed`);
      });
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds its size limit`);
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

const exactSemver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function normalizeVersion(input: string): string {
  const version = input.startsWith("v") ? input.slice(1) : input;
  if (input !== input.trim() || !exactSemver.test(version)) {
    throw new Error("Rootform version input must be an exact semantic version");
  }
  return version;
}

export async function resolveRelease(
  requested: string,
  token: string,
  fetcher: FetchLike = fetch,
): Promise<{ release: Release; version: string }> {
  const version = normalizeVersion(requested);
  const tag = `v${version}`;
  const path = `/repos/${releaseRepository}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await request(path, token, fetcher);
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Rootform release ${tag} was not found`);
    throw new Error(`GitHub release request failed with status ${response.status}`);
  }
  const body = await boundedBody(response, maxReleaseMetadataBytes, "Rootform release metadata");
  let release: Release;
  try {
    release = JSON.parse(body.toString("utf8")) as Release;
  } catch {
    throw new Error("Rootform release metadata is invalid JSON");
  }
  if (release.tag_name !== tag) throw new Error(`Rootform release tag does not match ${tag}`);
  if (release.draft !== false) throw new Error("draft Rootform releases are not installable");
  if (release.immutable !== true) throw new Error("mutable Rootform releases are not installable");
  if (!Array.isArray(release.assets)) throw new Error("Rootform release assets are invalid");
  return { release, version };
}

export async function downloadReleaseAsset(
  asset: ReleaseAsset,
  destination: string,
  token: string,
  fetcher: FetchLike = fetch,
  maxBytes = maxReleaseAssetBytes,
): Promise<void> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > maxReleaseAssetBytes ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > maxBytes
  ) {
    throw new Error(`Rootform release asset has invalid size: ${asset.name}`);
  }
  const response = await request(
    `/repos/${releaseRepository}/releases/assets/${asset.id}`,
    token,
    fetcher,
    "application/octet-stream",
  );
  if (!response.ok) throw new Error(`GitHub asset request failed with status ${response.status}`);
  const body = await boundedBody(response, maxBytes, `Rootform release asset ${asset.name}`);
  if (body.byteLength !== asset.size)
    throw new Error(`Rootform release asset size changed: ${asset.name}`);
  writeFileSync(destination, body, { flag: "wx" });
}
