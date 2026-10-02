# Migrating to the GitHub-native v1 Actions

This page records the change from the former root Action contract to the
accepted v1 surface. It does not include examples of the removed workflow
syntax. See the [README](../README.md) for the current golden path.

The six refs—<code>rootform-dev/action@v1</code>,
<code>rootform-dev/action/setup@v1</code>,
<code>rootform-dev/action/init@v1</code>,
<code>rootform-dev/action/analyze@v1</code>,
<code>rootform-dev/action/compare@v1</code> and
<code>rootform-dev/action/check@v1</code>—will point to one reviewed source
commit. They will be created only after qualification and merge. Examples use
the exact published CLI prerelease selected for qualification,
0.1.0-pr.117.1; they do not claim that stable CLI 0.1.0 has been published.

## Removed inputs

| Removed input | Current contract |
| --- | --- |
| <code>mode</code> | There is no source-versus-plan mode. Root <code>input</code> accepts a plan export, state export or saved Form. |
| <code>path</code> | Use root <code>input</code>, or <code>before</code> and <code>after</code> for comparison. Terraform configuration source is not an input mode. |
| <code>output-directory</code> | The Action owns result files and returns same-job file paths. Use artifact ID or URL for cross-job transfer. |
| <code>fail-on-violations</code>, <code>fail-on-changes</code> | Removed. Rootform's exact check exit code gates the step. Use GitHub <code>continue-on-error</code> when workflow steps must continue. |
| <code>report-diff</code>, <code>baseline-path</code> | Replaced by the compare flow using explicit before and after plan, state or Form operands. |
| <code>pull-request-token</code> | The root Action's opt-in comment uses the optional <code>github-token</code>, which defaults to <code>github.token</code>. |

<code>version</code> remains, but no longer accepts <code>latest</code> or a range. Supply an exact
published CLI version, or omit it only after an earlier Rootform Action step
verified and exported that version. <code>github-token</code> remains optional; public
release installation does not require authentication.

<code>locked</code>, <code>offline</code>, <code>cache</code>,
<code>upload-artifact</code> and <code>artifact-name</code> remain. Caching
contains only external Dialect and Policy Pack source payloads selected by an
existing project lock. Its key uses exact CLI version, runner platform and
lock-file bytes; it excludes locked/offline modes and has no cross-lock
restore-prefix fallback. An online run can warm the same cache for a later
offline run. Rootform verifies selected package digests after every restore.
Fork pull-request runs may read eligible base-repository caches; set
<code>cache: false</code> if selected source payloads are not appropriate for
that visibility. Never place credentials or private workflow data in cache.
Artifact names are unique by default. Any override must remain unique per
upload invocation.

## Removed outputs

| Removed output | Current contract |
| --- | --- |
| <code>preparation-mode</code>, <code>lock-path</code> | Preparation is explicit through project inputs or the init entrypoint. The Action does not publish the project's lock path. |
| <code>architecture</code> | Replaced by the <code>form</code> file-path output. For compare, it points to one Comparison Form. |
| <code>policy-json</code> | Replaced by <code>result</code>. |
| <code>diff-exit-code</code>, <code>diff-json</code>, <code>diff-markdown</code> | Compare returns a Form and CLI report paths. An architecture comparison does not invent a separate gating exit code. |
| <code>baseline-architecture</code>, <code>baseline-html</code> | Compare exposes its single resulting Form and HTML report; before and after operands are not separate outputs. |

Current business outputs are same-job paths such as <code>form</code>,
<code>report</code>, <code>html</code>, <code>result</code> and <code>sarif</code>,
plus <code>version</code> and the exact <code>exit-code</code> when a Policy
check ran. <code>artifact-id</code> and <code>artifact-url</code> identify
uploaded evidence for cross-job use. When present, artifact basenames are
<code>form.json</code>, <code>report.md</code>, <code>explorer.html</code>,
<code>result.json</code> and <code>results.sarif</code>. Summary Markdown is
enabled by default and forwards CLI reports and run/version/evidence links; it
does not calculate semantic counts. Upload of derived evidence is enabled by
default. For private or sensitive repositories, set
<code>summary: false</code> and <code>upload-artifact: false</code> unless
sharing derived evidence is intended; comments remain opt-in. Artifact
retention defaults to seven days, accepts 1–90 days and is subject to the
repository limit. Artifacts never include raw plan/state exports or saved
binary plans.

## Behavior and permissions

Supplying a Policy selector or Policy Pack overlay to the root Action requests
a check. <code>check: true</code> evaluates every Policy selected by
<code>rootform.lock</code>. There is no implicit Policy Pack selection. The CLI
produces and validates Forms and reports; the Action does not interpret
semantic JSON to create its own verdict.

The Action attempts the enabled evidence channels before applying Rootform's
exact non-zero check exit. No fail-on input changes that exit. Use the
workflow's step-level <code>continue-on-error</code> when later steps need to
run.

Normal use needs <code>contents: read</code>. Root-only PR commenting requires
<code>pull-requests: write</code> and <code>actions: read</code>, and runs only
on same-repository <code>pull_request</code> events. Fork comments are skipped;
every business entrypoint, including explicit init, rejects
<code>pull_request_target</code> before CLI installation. All reporting
workflows for one PR must share one job-level concurrency group with
<code>cancel-in-progress: false</code>.
Freshness checks do not make GitHub's comment API update atomic. Commenting is
GitHub.com only.

All entrypoints use Node 24 and require Actions Runner 2.327.1 or newer
([Node 24 runner requirement](https://github.com/actions/setup-node#breaking-changes-in-v5)).
Current GitHub artifact transport is unsupported on GHES
([artifact support](https://github.com/actions/upload-artifact#ghes-support));
disable it with <code>upload-artifact: false</code>.

The Action never runs Terraform or OpenTofu, reads cloud/provider/backend
credentials, or accepts Terraform configuration source. Its verified release
checks cover published digests, archive checksums, the manifest's raw
executable hash and the exact CLI version; they make no build-provenance
claim.
