export type PublicationIssue = { rule: string; line: number };

const rules: Array<[string, RegExp]> = [
  [
    "personal-path",
    /\/Users\/[^\s"'<>]+|\/home\/(?!rootform(?:\/|$)|runner(?:\/|$))[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\/gu,
  ],
  [
    "credential",
    /BEGIN (?:RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY|(?:github_pat_|ghp_)[A-Za-z0-9_]{12,}/gu,
  ],
  [
    "private-workspace",
    /(?:rootform-dev\/)?notes\/(?:public-separation|candidate-|ci-budget|operator-preferences|agentic-delivery|editor-qualification|site-quality|language-learning)/gu,
  ],
  [
    "session-instructions",
    /^\s*(?:#+\s*)?(?:system prompt|agent handoff|session report|rapport de session|instructions? (?:to|aux|pour) (?:models?|agents?)|model routing)\b|(?:Fable\s*5\.1|DeepSeek[- ]V4|Claude[- ](?:Opus|Fable)).{0,50}(?:review|revue|Max|max|instructions?)/gimu,
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
