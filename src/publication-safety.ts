export type PublicationIssue = { rule: string; line: number };

// Exact non-credential literals used by public synthetic provider fixtures.
const syntheticCredentialValues = new Set([
  "fixture000000000000000000000000000000000",
  "ROOTFORM_DATADOG_PROVIDER_API_KEY_SENTINEL",
  "ROOTFORM_NEWRELIC_BOUNDARY_SECRET_SENTINEL",
  "ROOTFORM_NEWRELIC_PROVIDER_KEY_SENTINEL",
  "ROOTFORM_OKTA_BOUNDARY_SECRET_SENTINEL",
  "ROOTFORM_OKTA_PROVIDER_TOKEN_SENTINEL",
  "ROOTFORM_DATADOG_CLOUDFLARE_KEY_SENTINEL",
  "ROOTFORM_DATADOG_FASTLY_KEY_SENTINEL",
  "ROOTFORM_HCP_DATADOG_API_SENTINEL",
  "ROOTFORM_ATLAS_OBSERVABILITY_SECRET",
]);

const rules: Array<[string, RegExp]> = [
  [
    "personal-path",
    /\/Users\/[^\s"'<>]+|\/home\/(?!rootform(?:\/|$)|runner(?:\/|$))[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\/gu,
  ],
  [
    "credential",
    /BEGIN (?:RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY|(?:github_pat_|gh[pousr]_|npm_)[A-Za-z0-9_]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|xox[abprs]-[A-Za-z0-9-]{12,}|AIza[A-Za-z0-9_-]{35}|\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/gu,
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
  const found: PublicationIssue[] = [];
  const scan = (source: string) => {
    for (let depth = 0; depth < 3; depth++) {
      const decoded = source
        .replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => {
          try {
            return decodeURIComponent(encoded);
          } catch {
            return encoded;
          }
        })
        .replace(
          /&(?:#(x[0-9a-f]+|[0-9]+)|amp|sol|colon|quot|apos);/giu,
          (entity, numeric: string | undefined) => {
            if (numeric) {
              const code = numeric.toLowerCase().startsWith("x")
                ? Number.parseInt(numeric.slice(1), 16)
                : Number(numeric);
              return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
            }
            return (
              (
                {
                  "&amp;": "&",
                  "&sol;": "/",
                  "&colon;": ":",
                  "&quot;": '"',
                  "&apos;": "'",
                } as Record<string, string>
              )[entity.toLowerCase()] ?? entity
            );
          },
        )
        .replaceAll("\0", "");
      if (decoded === source) break;
      source = decoded;
    }
    for (const [rule, pattern] of rules)
      for (const match of source.matchAll(pattern))
        found.push({ rule, line: source.slice(0, match.index).split("\n").length });
    const namedCredential =
      /\b(?:CLOUDFLARE_API_(?:TOKEN|KEY)|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|API_TOKEN|API_KEY)["']?\s*[:=]\s*["']?([A-Za-z0-9_+./~=-]{24,})/giu;
    for (const match of source.matchAll(namedCredential))
      if (!syntheticCredentialValues.has(match[1] ?? ""))
        found.push({ rule: "credential", line: source.slice(0, match.index).split("\n").length });
  };
  const inspect = (value: unknown, depth: number) => {
    if (depth > 128) {
      found.push({ rule: "uninspectable-content", line: 1 });
      return;
    }
    if (typeof value === "string") {
      scan(value);
      if (/^\s*[[{]/u.test(value)) {
        let nested: unknown;
        try {
          nested = JSON.parse(value);
        } catch {
          return;
        }
        inspect(nested, depth + 1);
      }
    } else if (Array.isArray(value)) for (const item of value) inspect(item, depth + 1);
    else if (value !== null && typeof value === "object") {
      const payload = value as Record<string, unknown>;
      if (
        typeof payload.content === "string" &&
        (payload.encoding === "base64" || ("message" in payload && payload.encoding === undefined))
      ) {
        try {
          if (
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
              payload.content,
            )
          )
            throw new Error("Invalid encoding");
          const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
            Uint8Array.from(atob(payload.content), (character) => character.charCodeAt(0)),
          );
          inspect(decoded, depth + 1);
        } catch {
          found.push({ rule: "uninspectable-content", line: 1 });
        }
      }
      for (const [key, item] of Object.entries(payload)) {
        if (
          /^(?:CLOUDFLARE_API_(?:TOKEN|KEY)|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|API_TOKEN|API_KEY)$/iu.test(
            key,
          ) &&
          typeof item === "string" &&
          !syntheticCredentialValues.has(item) &&
          /^[A-Za-z0-9_+./~=-]{24,}$/u.test(item)
        )
          found.push({ rule: "credential", line: 1 });
        scan(key);
        inspect(item, depth + 1);
      }
    }
  };
  scan(text);
  // Parsing valid JSON reveals escapes without interpreting regex or source-code literals.
  let structured: unknown;
  try {
    structured = JSON.parse(text);
  } catch {
    return found;
  }
  inspect(structured, 0);
  return found;
}

/** Validate all outbound strings before a bot makes its first write. */
export function assertPublicMessage(value: unknown): void {
  if (value === undefined) return;
  let text: string;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("Invalid payload");
    text = serialized;
  } catch {
    throw new Error("Public message refused: uninspectable-content");
  }
  const issues = publicationIssues(text);
  const issue = issues[0];
  if (issue) throw new Error(`Public message refused: ${issue.rule}`);
}

export function assertReportMessage(
  value: unknown,
  repository = process.env.GITHUB_REPOSITORY ?? "",
): void {
  if (
    [
      "rootform-dev/rootform",
      "rootform-dev/action",
      "rootform-dev/editors",
      "rootform-dev/extensions",
      "rootform-dev/action-qualification",
      "rootform-dev/homebrew-tap",
    ].includes(repository)
  ) {
    assertPublicMessage(value);
    return;
  }
  let text: string;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("Invalid payload");
    text = serialized;
  } catch {
    throw new Error("Public report refused: uninspectable-content");
  }
  const issue = publicationIssues(text).find(
    (issue) => issue.rule === "credential" || issue.rule === "uninspectable-content",
  );
  if (issue) throw new Error(`Public report refused: ${issue.rule}`);
}
