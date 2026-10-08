# Set up Rootform

Use the setup action when a job needs the verified `rootform` executable on
`PATH` for later CLI steps. Business actions install the CLI themselves, so a
separate setup step is optional.

```yaml
steps:
  - uses: rootform-dev/action/setup@v1
    id: rootform
    with:
      version: 0.1.0
  - name: Confirm the installed CLI
    run: rootform version
```

Setup installs and verifies one exact published version, then exposes the
executable on `PATH`. Omit `version` only when an earlier Rootform Action step
in the same job has already installed and verified the version. Setup does
not create `ROOTFORM_HOME` or prepare project content.

The outputs are `version` (the exact verified CLI version) and `sha256` (the
installed executable's digest). They are values, not file paths. Public release
installation needs no credential; the optional `github-token` is for GitHub
API rate limits and is not sent to Rootform.

See the complete [setup input and output reference](https://docs.rootform.dev/integrations/github-actions/setup/) or return to the [Action quickstart](../README.md).
