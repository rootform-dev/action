# ADR-002: Action runtime and verified release assets

- Status: Accepted
- Date: 2026-08-30
- Amended: 2026-08-31
- Owners: @soulbah
- Owner approval: @soulbah — 2026-08-30 (delegated implementation decision
  within accepted four-repository split)
- Amendment approval: @soulbah — 2026-08-31 (consume published Rootform
  releases only; authentication never authorizes draft consumption)
- Related spec: `specs/001-rootform-action/spec.md`

## Context

Action needs current GitHub-hosted JavaScript runtime, one cross-platform
installer, artifact upload, and private-to-public release transition without
embedding private entitlement in future API.

Current official evidence:

- GitHub metadata supports `runs.using: node24`.
- `GITHUB_TOKEN` is limited to repository containing workflow.
- release API accepts unauthenticated reads for public resources and a token
  with `Contents: read` for private resources;
- release asset objects carry optional `sha256:` digest;
- npm registry stable versions queried 2026-08-30 are `@actions/core` 3.0.1,
  `@actions/tool-cache` 4.0.0, and `@actions/artifact` 6.2.1;
- official artifact package supports Node 24 and immutable uploads on GitHub
  Actions, but not current GHES artifact backend.

## Decision

- Both entrypoints run committed bundles on Node 24.
- Exact direct runtime dependencies above are bundled with Bun 1.3.14. No npm,
  ncc, esbuild, or second bundler is added.
- Release repository is fixed at `rootform-dev/rootform`.
- Version input defaults to `latest`; resolved output is always exact. Private
  tests pass exact version plus optional `github-token` against a published
  prerelease. Public downloads use identical path without token.
- Exact-version resolution uses only GitHub's release-by-tag endpoint. Action
  rejects a response unless `draft` is explicitly false, even when caller
  supplies a token. It never lists releases to discover authenticated drafts.
  `latest` additionally rejects prereleases.
- Asset names are `rootform_<version>_<os>_<arch>.tar.gz`, except Windows uses
  `.zip`. Supported map is linux amd64/arm64, darwin amd64/arm64, and windows
  amd64. Other runner combinations fail.
- Installer fetches release metadata and assets through versioned GitHub REST
  API, verifies API digest when present and exact entry in `SHA256SUMS`, extracts
  with official tool-cache, verifies executable reports requested version, then
  caches and adds directory to `PATH`.
- Main run writes five allow-listed files: `architecture.json`,
  `architecture.html`, `policy.json`, `policy.sarif`, and `summary.md`.
  Artifact upload contains first four; Job Summary receives fifth. No glob over
  workspace or user Terraform is permitted.
- After install, only optional Actions artifact upload performs network I/O.

## Alternatives considered

- **Node 20:** rejected because Node 24 is current supported Action runtime and
  selected official dependencies support it.
- **Shell composite action:** rejected because verified cross-platform download,
  digest handling, cache, and artifact API would split into three installers.
- **Custom artifact REST client:** rejected because official client owns runner
  artifact protocol and authentication.
- **Required token input:** rejected because public releases need none.
- **Authenticated draft fallback:** rejected because Rootform owns candidate
  qualification and publication; unfinished draft assets are not product
  releases.
- **Parse JSON for summary or verdict:** rejected because CLI owns semantics and
  already emits Markdown plus exit status.
- **Floating release asset or checksum URL:** rejected because Action resolves
  exact release and verifies exact named assets.

## Consequences

Bundles are larger because official artifact client ships its dependencies.
GHES remains unsupported for artifact upload. Private integration requires a
narrow `Contents: read` credential for distribution repository; this disappears
from normal caller configuration after public release.

## Validation

Unit tests use synthetic release metadata and local HTTP responses. Bundle runs
twice and compares bytes. Clean integration uses one private published
prerelease plus an authenticated draft rejection, isolated runner paths, source
and plan fixtures, checksum corruption negative case, summary, and artifact
verification.

## Reversal

Revert Action manifests, source, bundles, and exact runtime dependencies. No
tag or release mutation is required because task publishes none.
