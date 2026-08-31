# SPEC-002 real pull-request evidence

- Date: 2026-08-31
- Implementation: [action PR #8](https://github.com/rootform-dev/action/pull/8)
- Disposable proof: [action PR #9](https://github.com/rootform-dev/action/pull/9)
- Published CLI exercised: `rootform 0.1.0-dev.2`
- Event: `pull_request`
- Workflow permissions: `contents: read`, `pull-requests: write`
- Comment author: `github-actions[bot]`
- Comment identity: `5485676893`
- Comment URL: [live updated report](https://github.com/rootform-dev/action/pull/9#issuecomment-5485676893)

Proof PR #9 targets the implementation branch and is not intended to merge.
It contains synthetic Terraform and a minimal vendored subset of official
dialects. No product release or tag was created; Action tag `v0.1.0` remained
unchanged.

## Changed run

- Workflow: [run 33447403911](https://github.com/rootform-dev/action/actions/runs/33447403911)
- Job: [architecture review](https://github.com/rootform-dev/action/actions/runs/33447403911/job/99669478220)
- Conclusion: `success`
- Annotation: warning — `Rootform detected architecture changes.`
- Artifact: [rootform-pr-9](https://github.com/rootform-dev/action/actions/runs/33447403911/artifacts/9778517589), ID `9778517589`, 1,623,842 bytes
- Exact visible report: [`changed-comment.md`](changed-comment.md)

Observed CLI diff:

```text
added   aws/internet-gateway "main"
removed core/subnet "application"
added   core/subnet "public"
```

The full CLI Markdown also reports three matching network-context changes.

## Unchanged update

- Workflow: [run 33447592934](https://github.com/rootform-dev/action/actions/runs/33447592934)
- Job: [architecture review](https://github.com/rootform-dev/action/actions/runs/33447592934/job/99670065875)
- Conclusion: `success`
- Annotation: notice — `Rootform architecture is unchanged and policy checks passed.`
- Artifact: [rootform-pr-9](https://github.com/rootform-dev/action/actions/runs/33447592934/artifacts/9778584206), ID `9778584206`, 1,623,034 bytes
- Exact visible report: [`unchanged-comment.md`](unchanged-comment.md)

The same comment ID was created at `2026-08-31T22:33:30Z` and last updated at
`2026-08-31T22:44:37Z`. Querying marker-owned bot comments returned exactly
one result after every run.

## Artifact contract observed

Both downloaded artifacts contained exactly:

```text
architecture-diff.json
architecture-diff.md
architecture.html
architecture.json
baseline-architecture.html
baseline-architecture.json
policy.json
policy.sarif
```

Final unchanged evidence proved byte equality:

```text
b468abfc324828f413cde0792c4d0b6cad7e4c7db83180024ad74f0e28321d56  architecture.json
b468abfc324828f413cde0792c4d0b6cad7e4c7db83180024ad74f0e28321d56  baseline-architecture.json
3c20f3b2f397f3384c96fffe03763e380b681c1c8d1dff8ec47764b192f360b5  architecture.html
3c20f3b2f397f3384c96fffe03763e380b681c1c8d1dff8ec47764b192f360b5  baseline-architecture.html
```

`architecture-diff.md` contained `No architectural change.`. Policy JSON and
SARIF hashes were stable across changed and unchanged runs.

## Boundary observations

- Release and pull-request inputs were masked in workflow logs.
- Comment evidence linked both workflow and downloadable artifact after the
  artifact URL fallback was corrected from the first live run.
- Rootform CLI executed after verified binary installation and received no
  GitHub credential environment variables.
- Pull-request comment used only the dedicated token input and normal
  `pull_request` event. No `pull_request_target` or custom check run existed.
- Job Summary used the same deterministic report renderer; its authenticated
  UI remains available through each workflow-run link.
