# Check Rootform evidence

Use check to evaluate a plan export, state export, or saved Form against an
explicit Policy selection. No Policy Pack is selected implicitly.

```yaml
steps:
  - uses: rootform-dev/action/check@v1
    id: policy-check
    with:
      version: <rootform-version>
      input: ${{ runner.temp }}/plan.json
      plan-file: ${{ runner.temp }}/plan.tfplan
      policy-pack: ./policies/team
```

For raw plan JSON, pair `plan-file` with the saved binary plan from that same
run; a supplied pair must verify. State exports and saved Forms do not use
`plan-file`. Use `policy` to select or narrow Policies, or `policy-pack` for
local Pack directories or compiled files. Selectors and Pack paths accept one
value per line. `side` applies when checking a Comparison Form; its default is
both sides.

The outputs `form`, `result`, `report`, and `sarif` are same-job file paths.
`exit-code` is Rootform's exact check exit code. The Action publishes available
outputs, Summary, and artifact before applying a nonzero exit as the step's
failure; GitHub's `continue-on-error` controls later workflow steps. Artifacts
and Summary are enabled by default. Successful upload also exposes
`artifact-id` and `artifact-url`.

See the complete [check input and output reference](https://docs.rootform.dev/integrations/github-actions/check/) or return to the [Action quickstart](../README.md).

Replace `<rootform-version>` with an exact published CLI version.
