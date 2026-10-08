# Analyze one Rootform input

Use analyze to turn a plan export, state export, or saved Form into a Form and
human-readable reports.

```yaml
steps:
  - uses: rootform-dev/action/analyze@v1
    id: analysis
    with:
      version: <rootform-version>
      input: ${{ runner.temp }}/plan.json
      plan-file: ${{ runner.temp }}/plan.tfplan
```

For raw plan JSON, `plan-file` pairs the JSON with the saved binary plan from
the same plan run. A supplied pair must verify. State exports and saved Forms
do not use `plan-file`. Rootform owns validation and interpretation; reopening
a saved Form keeps its original path and bytes.

Use `steps.analysis.outputs.form`, `report`, and `html` as file paths in later
steps of the same job. They do not contain file bodies. Successful artifact
upload also exposes `artifact-id` and `artifact-url`; the default artifact
contains only the Form and derived reports. Summary and upload are enabled by
default. Set `upload-artifact: false` when the evidence should stay in the job.

See the complete [analyze input and output reference](https://docs.rootform.dev/integrations/github-actions/analyze/) or return to the [Action quickstart](../README.md).

Replace `<rootform-version>` with an exact published CLI version.
