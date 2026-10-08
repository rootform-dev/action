# Prepare a Rootform project

Use init as a separate preparation step when you want to fetch or verify the
external Dialects and Policy Packs selected by a project's `rootform.lock`
before analysis or checking. Business actions prepare content when needed, so
standalone init is optional.

```yaml
steps:
  - uses: rootform-dev/action/init@v1
    with:
      version: <rootform-version>
      project: infra
      locked: true
```

`project` defaults to the workspace. `locked: true` requires the existing
`infra/rootform.lock` and preserves it; the action never creates or edits the
lock. With `offline: true`, preparation uses verified local content only. The
default cache can transport only external source payloads selected by that
lock; Rootform verifies restored content again. No plan, Form, report, or
credential is cached.

Init runs Rootform preparation only. It never runs Terraform or OpenTofu. Its
only output is `version`, the exact verified CLI version. The job-local
`ROOTFORM_HOME` is shared with later business actions.

See the complete [init input and output reference](https://docs.rootform.dev/integrations/github-actions/init/) or return to the [Action quickstart](../README.md).

Replace `<rootform-version>` with an exact published CLI version.
