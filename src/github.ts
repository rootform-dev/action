import { writeFileSync } from "node:fs";

export const releaseRepository = "rootform-dev/rootform";
const apiVersion = "2026-03-10";
const userAgent = "rootform-action";

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
  const response = await fetcher(`https://api.github.com${path}`, {
    headers: requestHeaders(token, accept),
    redirect: "follow",
  });
  return response;
}

async function jsonRequest<T>(path: string, token: string, fetcher: FetchLike): Promise<T> {
  const response = await request(path, token, fetcher);
  if (!response.ok) throw new Error(`GitHub release request failed with status ${response.status}`);
  return (await response.json()) as T;
}

export function normalizeVersion(input: string): string {
  const value = input.trim();
  if (value === "latest") return value;
  const version = value.startsWith("v") ? value.slice(1) : value;
  if (
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(
      version,
    )
  ) {
    throw new Error(`Rootform version is invalid: ${value}`);
  }
  return version;
}

export async function resolveRelease(
  requested: string,
  token: string,
  fetcher: FetchLike = fetch,
): Promise<{ release: Release; version: string }> {
  const normalized = normalizeVersion(requested);
  if (normalized === "latest") {
    const release = await jsonRequest<Release>(
      `/repos/${releaseRepository}/releases/latest`,
      token,
      fetcher,
    );
    if (release.draft !== false || release.prerelease !== false)
      throw new Error("latest Rootform release is not stable");
    return { release, version: normalizeVersion(release.tag_name) };
  }

  const tag = `v${normalized}`;
  const response = await request(
    `/repos/${releaseRepository}/releases/tags/${encodeURIComponent(tag)}`,
    token,
    fetcher,
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Rootform release ${tag} was not found`);
    throw new Error(`GitHub release request failed with status ${response.status}`);
  }
  const release = (await response.json()) as Release;
  if (release.tag_name !== tag) throw new Error(`Rootform release tag does not match ${tag}`);
  if (release.draft !== false) throw new Error("draft Rootform releases are not installable");
  return { release, version: normalized };
}

export async function downloadReleaseAsset(
  asset: ReleaseAsset,
  destination: string,
  token: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 512 * 1024 * 1024) {
    throw new Error(`Rootform release asset has invalid size: ${asset.name}`);
  }
  const response = await request(
    `/repos/${releaseRepository}/releases/assets/${asset.id}`,
    token,
    fetcher,
    "application/octet-stream",
  );
  if (!response.ok) throw new Error(`GitHub asset request failed with status ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== asset.size)
    throw new Error(`Rootform release asset size changed: ${asset.name}`);
  writeFileSync(destination, body, { flag: "wx" });
}
