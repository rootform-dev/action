# Published CLI and runtime preflight

Local preflight on 2026-10-02 used the existing published immutable CLI
[v0.1.0-pr.117.1](https://github.com/rootform-dev/rootform/releases/tag/v0.1.0-pr.117.1).
No CLI was built from local sources and no private producer workflow ran.

- Actual CLI: analyze with saved-plan pairing, saved Form reopen, mixed
  Form/plan comparison with independently paired saved plan, direct check and
  saved Form check succeeded. One analysis wrote Form/Markdown/HTML; one check
  wrote JSON/Markdown/SARIF. The example Form was 2,360,199 bytes, so no machine
  content belongs in a step output or a 1 MiB stdout capture.
- `bun run test:integration` passed eight actual published-CLI cases:
  enriched analysis, unchanged saved Form reuse, mixed comparison, direct check,
  both-side Comparison Form check, violation (1), no verdict (3), and state.
  Runtime unit tests passed 77 cases with 518 assertions. Hosted proof remains
  separate from these local results.
- A new synthetic Policy Pack whose managed-database assertion is false
  returned exact exit 1 and complete JSON/Markdown/SARIF; no verdict was derived
  by the Action.
- The actual Node 24.11.0 shared bundle installed anonymously from a cold tool
  cache. macOS ARM64 executable hash was
  `3193b1c91e7877c15beb84f1a7cdb8f89a9640f81118b89f17d9707da5cbb94a`,
  version exactly `0.1.0-pr.117.1`, matching verified release metadata.
- A source Policy Pack produced by this same published CLI was published into
  an isolated TLS registry, acquired into a fresh Linux home, then verified
  with `init --locked --offline` in a container with network disabled. Its OCI
  manifest digest was
  `sha256:efc30645d6de2d272f9af70829b32e2e1c29ceafde5492a03d5c9e7ad72d9a5d`.
  Registry image was pinned to
  `registry:3@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8`.
  The TLS key stayed in temporary local storage and is not evidence or source.

The existing official GHCR tag `policy-pack-baseline-0.1.0` resolves to manifest
`sha256:063fc43e911bf727e37c3baec565a81b94eaecf0cff5dc89d72b6a17207ab758`.
Its old configuration includes `requires: core` and `policy_pack_digest`; the
current CLI refuses it as an invalid package manifest. This existing package
was not modified and is not used as proof for the current contract. Official
package cleanup/publication remains distinct from Action qualification.

This record proves local preflight only. Real public GitHub consumer evidence,
all runner platforms, artifact downloads and comments belong in qualification.md.
