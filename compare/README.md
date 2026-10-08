# Compare two Rootform inputs

Use compare to present differences between before and after plan exports,
state exports, or single-input Forms.

```yaml
steps:
  - uses: rootform-dev/action/compare@v1
    id: comparison
    with:
      version: 0.1.0
      before: ${{ runner.temp }}/before/plan.json
      before-plan-file: ${{ runner.temp }}/before/plan.tfplan
      after: ${{ runner.temp }}/after/plan.json
      after-plan-file: ${{ runner.temp }}/after/plan.tfplan
```

Each saved plan must match its corresponding plan JSON. For state or Form
operands, omit that side's saved-plan input. Optional `before-stage` and
`after-stage` inputs select the stage shown for each side.

The `form` output is one Comparison Form; there are no separate before and
after Form paths. `report` and `html` are also same-job file paths, not file
bodies. A Comparison Form can be reopened by analyze or check, but cannot be
used as a compare operand. Successful artifact upload exposes `artifact-id`
and `artifact-url`; upload and Summary are enabled by default.

See the complete [compare input and output reference](https://docs.rootform.dev/integrations/github-actions/compare/) or return to the [Action quickstart](../README.md).
