# Security policy

Report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/rootform-dev/action/security/advisories/new). Do not open a public issue for an exploitable finding.

Never attach real Terraform state, plan files, credentials, tokens, private keys, customer configuration, cloud account identifiers, or unredacted workflow logs. Build the smallest synthetic reproduction instead.

A finding in Rootform's architecture semantics belongs to `rootform-dev/rootform`. A finding in installation, checksum verification, privilege scope, or what this action writes to logs, outputs, summaries, or artifacts belongs here.

Security reports should include affected revision, impact, reproduction conditions, and suggested containment when known. Maintainers will acknowledge and triage reports before discussing disclosure timing.
