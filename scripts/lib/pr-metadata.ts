import { validateCommitSubject } from "./commit-message.ts";

export type PullRequestValidation = { errors: string[] };

const REQUIRED_HEADINGS = [
  "## Spec and outcome",
  "## Done when and evidence",
  "## Risk and privacy",
  "## Review checklist",
];

const REQUIRED_FIELDS = [
  "Spec or repository-only rationale",
  "Accepted outcome",
  "Explicit non-goals",
  "Done when command or protocol",
  "Evidence path or exact output",
  "Security/privacy impact",
  "Offline and determinism impact",
  "Dependency or toolchain change",
  "Rollback path",
];

export function validatePullRequestMetadata(title: string, body: string): PullRequestValidation {
  const errors: string[] = [];
  const titleResult = validateCommitSubject(title);
  if (!titleResult.valid) errors.push(`title: ${titleResult.reason}`);

  for (const heading of REQUIRED_HEADINGS) {
    if (!body.includes(heading)) errors.push(`missing pull request section: ${heading}`);
  }
  const fields = new Map<string, string>();
  for (const line of body.split(/\r?\n/u)) {
    if (!line.startsWith("- ")) continue;
    const separator = line.indexOf(":", 2);
    if (separator === -1) continue;
    fields.set(line.slice(2, separator).trim(), line.slice(separator + 1).trim());
  }
  for (const field of REQUIRED_FIELDS) {
    if (!fields.get(field)) errors.push(`missing pull request value: ${field}`);
  }
  if (/\b(?:TODO|TBD|Pending)\b|<!--\s*required:/u.test(body)) {
    errors.push("pull request body contains unresolved placeholder");
  }
  if ((body.match(/^- \[[xX]\] /gmu) ?? []).length < 4) {
    errors.push("review checklist must be completed");
  }

  return { errors };
}
