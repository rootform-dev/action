# Toolchain and dependency policy

## Principle

Use the newest stable, mutually compatible release set at adoption time. “Newest” is resolved from official release notes or registries, then pinned exactly. A mutable `latest` tag is discovery input, never committed configuration.

Exclude prereleases, nightly builds, abandoned packages, and combinations whose peer requirements or runtime behavior have not been verified.

## Active foundation toolchain

`package.json`, `bun.lock`, workflow SHAs, and CI checks are source of truth. The
current foundation pins Bun 1.3.14, TypeScript 7.0.2, Biome 2.5.8, Bun types
1.3.14, Gitleaks 8.30.1, and actionlint 1.7.12. Release automation pins
semantic-release 25.0.9 with `@semantic-release/commit-analyzer` 13.0.1,
`@semantic-release/release-notes-generator` 14.1.1, `@semantic-release/github`
12.0.9, and `conventional-changelog-conventionalcommits` 10.4.0. Any runtime
dependency an action entrypoint needs requires fresh compatibility validation in
an accepted spec.

semantic-release 25 requires Node `^22.14.0 || >= 24.10.0`, which Bun does not
satisfy. The release job therefore pins Node 24.20.0 alongside Bun. Bun still
performs the install; Node only executes the release binary.

External binaries used by a gate are pinned by version and SHA-256, downloaded
from their upstream release, and verified before use. A tool that cannot be
verified this way does not enter the gate.

## Adoption procedure

1. Query official release pages or package registries on the implementation day.
2. Reject prereleases and confirm maintenance, license, provenance, security status, and platform support.
3. Resolve the whole peer graph. Newest individually does not outrank newest compatible set.
4. Run a disposable technical spike for risky runtime, bundler, or runner combinations.
5. Pin exact versions and toolchains; generate lockfiles with their owning tool.
6. Record deviations from newest stable, reason, evidence, owner, and removal condition in spec or ADR.
7. Run format, static analysis, tests, bundle build, and reproducibility checks before acceptance.

## JavaScript rules

- Bun only. Commit `bun.lock`; never commit npm, pnpm, or Yarn lockfiles.
- Set exact `packageManager: "bun@x.y.z"` in the owning `package.json`.
- Do not use `bunx` for unpinned auto-downloads. Invoke committed package scripts or installed local binaries.
- No network fetch, CDN, or package resolution occurs at action runtime beyond
  downloading the pinned Rootform release the caller asked for.

## Action runtime rules

- GitHub executes the committed bundle under the Node runtime named by
  `runs.using`. That runtime is a published contract: raising it is a breaking
  change for older runners and requires an accepted spec.
- The bundle is build output. It is committed because GitHub requires it, is
  never hand-edited, and `bun run verify` proves it reproduces from `src/`.
- Runtime dependencies are bundled, so every added package ships to every
  caller. Prefer the Node standard library and the already-present Actions
  toolkit before adding one.
- Prefer a pinned Rootform CLI version. When the caller names no version, the
  action resolves the latest published release, records the exact resolved
  version in its output, and still verifies its checksum.

## Automation

- GitHub Actions use immutable 40-character commit SHAs with tag comments.
- Dependabot tracks Bun and GitHub Actions. Group routine weekly updates.
- Never run two dependency bots against the same ecosystem.
- Security updates receive priority but still pass all gates. No blind auto-merge.
- Review stable releases at least weekly during active development and before each release cut.
- Releases are produced only by `.github/workflows/release.yml` on `main`.
  Automation never moves a published tag, never publishes to a registry, and
  never pushes a commit into a protected branch. See
  `docs/adr/001-release-automation.md`.
