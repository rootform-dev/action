export type PublicationIssue = { rule: string; line: number };

const rules: Array<[string, RegExp]> = [
  [
    "personal-path",
    /\/Users\/[^\s"'<>]+|\/home\/(?!rootform(?:\/|$)|runner(?:\/|$))[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\/gu,
  ],
  [
    "credential",
    /BEGIN (?:RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY|(?:github_pat_|gh[pousr]_|npm_)[A-Za-z0-9_]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|xox[abprs]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{35}|\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*|\b(?:CLOUDFLARE_API_TOKEN|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|API_TOKEN|API_KEY)\s*[:=]\s*["\x27]?[A-Za-z0-9_+./~-]{24,}/gu,
  ],
  ["private-workspace", /\b(?:rootform-dev\/)?notes\/[A-Za-z0-9][A-Za-z0-9._/-]*/gu],
  [
    "session-instructions",
    /^\s*(?:#+\s*)?(?:system prompt|agent handoff|session report|rapport de session|instructions? (?:to|aux|pour) (?:models?|agents?)|model routing)\b|\b[A-Z][A-Za-z0-9_-]*[- ]V?\d+\.\d+\s+(?:Max|Ultra)\b.{0,40}\b(?:review|revue|instructions?)\b|\b(?:model routing|review with|revue avec)\s*[:=]/gimu,
  ],
  [
    "private-activity",
    /(?:\d+\s+(?:merged\s+)?(?:private|engine|web)\s+(?:pull requests|PRs))|(?:private|engine|web)\s+(?:pull requests|PRs)\s+(?:included|merged|count)/giu,
  ],
];

/** Return only rule and line; never retain or display the matched value. */
export function publicationIssues(text: string): PublicationIssue[] {
  return rules.flatMap(([rule, pattern]) =>
    [...text.matchAll(pattern)].map((match) => ({
      rule,
      line: text.slice(0, match.index).split("\n").length,
    })),
  );
}

/** Validate all outbound strings before a bot makes its first write. */
export function assertPublicMessage(value: unknown): void {
  if (typeof value === "string") {
    const issue = publicationIssues(value)[0];
    if (issue) throw new Error(`Public message refused: ${issue.rule}`);
  } else if (Array.isArray(value)) {
    for (const item of value) assertPublicMessage(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertPublicMessage(item);
  }
}

/** Consumer reports may contain user-authored model data and local paths.
 * Credential-shaped values are still refused before any public write. */
export function assertReportMessage(
  value: unknown,
  repository = process.env.GITHUB_REPOSITORY ?? "",
): void {
  if (
    ["rootform-dev/rootform", "rootform-dev/action", "rootform-dev/editors"].includes(repository)
  ) {
    assertPublicMessage(value);
    return;
  }
  if (typeof value === "string") {
    if (publicationIssues(value).some((issue) => issue.rule === "credential"))
      throw new Error("Public report refused: credential");
  } else if (Array.isArray(value)) {
    for (const item of value) assertReportMessage(item, repository);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertReportMessage(item, repository);
  }
}
