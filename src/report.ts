const COMMENT_LIMIT = 60_000;
const SUMMARY_LIMIT = 900 * 1024;

export const REPORT_MARKER = "<!-- rootform:architecture-review -->";

export type ReportOptions = {
  artifactUrl?: string;
  baseSha?: string;
  baselinePath?: string;
  commentState?: string;
  currentPath: string;
  diffExitCode?: number;
  diffMarkdown?: string;
  headSha?: string;
  mode: "plan" | "source";
  policyExitCode: number;
  policyMarkdown: string;
  preparation?: PreparationSummary;
  version: string;
  workflowUrl?: string;
};

/* Preparation presentation carries dialect identity and the caller-facing lock
   state only. It never carries a runner path, an environment value, raw
   Terraform material, or a credential. */
export type PreparationSummary = {
  dialects: Array<{ name: string; version: string }>;
  lockCreated: boolean;
  lockPath?: string;
  resolutionMode: string;
  unsupportedProviders: string[];
};

export const GENERATED_LOCK_MESSAGE =
  "Rootform generated rootform.lock for this run. Commit this file to make future analyses reproducible.";

export type ReportTarget = "comment" | "summary";

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function inline(value: string): string {
  const normalized = value.replaceAll("\r", " ").replaceAll("\n", " ");
  const longest = Math.max(...[...normalized.matchAll(/`+/gu)].map(([ticks]) => ticks.length), 0);
  const fence = "`".repeat(longest + 1);
  const padding = normalized.startsWith("`") || normalized.endsWith("`") ? " " : "";
  return `${fence}${padding}${normalized}${padding}${fence}`;
}

function link(label: string, url: string): string {
  return `[${label}](${url.replaceAll("(", "%28").replaceAll(")", "%29")})`;
}

function evidenceLinks(options: ReportOptions): string {
  const links = [
    options.artifactUrl ? link("Download complete evidence", options.artifactUrl) : undefined,
    options.workflowUrl ? link("Open workflow run", options.workflowUrl) : undefined,
  ].filter((value): value is string => Boolean(value));
  return links.length > 0 ? links.join(" · ") : "No evidence link available";
}

function identity(options: ReportOptions): string {
  if (options.baseSha && options.headSha) {
    return `${inline(`base:${options.baseSha.slice(0, 7)}`)} → ${inline(
      `head:${options.headSha.slice(0, 7)}`,
    )}`;
  }
  if (options.mode === "source" && options.baselinePath) {
    return `${inline(`baseline:${options.baselinePath}`)} → ${inline(
      `current:${options.currentPath}`,
    )}`;
  }
  return inline(`current:${options.currentPath}`);
}

function architectureOutcome(exitCode: number | undefined): string {
  if (exitCode === undefined) return "Not requested";
  if (exitCode === 0) return "✅ No changes";
  if (exitCode === 1) return "⚠️ Changes detected";
  throw new Error(`unsupported diff exit code ${exitCode}`);
}

function policyOutcome(exitCode: number): string {
  if (exitCode === 0) return "✅ Passed";
  if (exitCode === 1) return "⚠️ Violations detected";
  throw new Error(`unsupported policy exit code ${exitCode}`);
}

function alert(options: ReportOptions): string {
  const changed = options.diffExitCode === 1;
  const violations = options.policyExitCode === 1;
  if (!changed && !violations) {
    const message =
      options.diffExitCode === undefined
        ? "Policy checks passed."
        : "Architecture is unchanged and policy checks passed.";
    return `> [!NOTE]\n> ${message}`;
  }
  if (changed && violations) {
    return "> [!WARNING]\n> Architecture changes and policy violations detected.";
  }
  if (changed) return "> [!WARNING]\n> Architecture changes detected.";
  return "> [!WARNING]\n> Policy violations detected.";
}

function exactSection(title: string, markdown: string, expanded: boolean): string {
  const suffix = markdown.endsWith("\n") ? "" : "\n";
  const open = expanded ? " open" : "";
  return `<details${open}>\n<summary><strong>${title}</strong></summary>\n\n${markdown}${suffix}\n</details>`;
}

function omittedSection(title: string, options: ReportOptions): string {
  return `<details>\n<summary><strong>${title}</strong></summary>\n\nExact CLI Markdown exceeds this GitHub surface's inline limit. ${evidenceLinks(
    options,
  )}.\n\n</details>`;
}

function report(
  options: ReportOptions,
  target: ReportTarget,
  inlineDiff: boolean,
  inlinePolicy: boolean,
): string {
  const sections: string[] = [];
  if (target === "comment") sections.push(REPORT_MARKER);
  sections.push("## Rootform architecture review", identity(options), alert(options));
  sections.push(
    [
      "| Review gate | Result |",
      "| --- | --- |",
      `| Architecture | ${architectureOutcome(options.diffExitCode)} |`,
      `| Policies | ${policyOutcome(options.policyExitCode)} |`,
      `| Rootform | ${inline(options.version)} |`,
    ].join("\n"),
  );

  if (options.preparation?.lockCreated) {
    sections.push(`> [!IMPORTANT]\n> ${GENERATED_LOCK_MESSAGE}`);
  }

  if (options.diffMarkdown !== undefined) {
    sections.push(
      inlineDiff
        ? exactSection("Architecture changes", options.diffMarkdown, true)
        : omittedSection("Architecture changes", options),
    );
  }
  sections.push(
    inlinePolicy
      ? exactSection("Policy checks", options.policyMarkdown, options.policyExitCode === 1)
      : omittedSection("Policy checks", options),
  );

  if (options.preparation) {
    const preparation = options.preparation;
    const rows = [
      `- Resolution mode: ${inline(preparation.resolutionMode)}`,
      `- Dialects: ${
        preparation.dialects.length === 0
          ? "None required"
          : preparation.dialects.map(({ name, version }) => inline(`${name}@${version}`)).join(", ")
      }`,
      `- Project lock: ${
        preparation.lockCreated
          ? "Generated for this run"
          : preparation.lockPath
            ? `Committed at ${inline(preparation.lockPath)}`
            : "Not present"
      }`,
      ...(preparation.unsupportedProviders.length > 0
        ? [
            `- Providers without an official dialect: ${preparation.unsupportedProviders
              .map((provider) => inline(provider))
              .join(", ")}`,
          ]
        : []),
    ];
    sections.push(
      `<details>\n<summary><strong>Dialect preparation</strong></summary>\n\n${rows.join(
        "\n",
      )}\n\n</details>`,
    );
  }

  sections.push(`### Evidence\n\n${evidenceLinks(options)}`);

  const provenance = [
    `- Mode: ${inline(options.mode)}`,
    `- Current input: ${inline(options.currentPath)}`,
    ...(options.baselinePath ? [`- Baseline input: ${inline(options.baselinePath)}`] : []),
    ...(options.baseSha ? [`- Base commit: ${inline(options.baseSha)}`] : []),
    ...(options.headSha ? [`- Head commit: ${inline(options.headSha)}`] : []),
    ...(options.commentState ? [`- Pull-request comment: ${options.commentState}`] : []),
  ];
  sections.push(
    `<details>\n<summary>Run provenance</summary>\n\n${provenance.join("\n")}\n\n</details>`,
  );
  return `${sections.join("\n\n")}\n`;
}

export function renderReport(options: ReportOptions, target: ReportTarget): string {
  const limit = target === "comment" ? COMMENT_LIMIT : SUMMARY_LIMIT;
  const candidates: Array<[boolean, boolean]> = options.diffMarkdown
    ? [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ]
    : [
        [false, true],
        [false, false],
      ];
  for (const [inlineDiff, inlinePolicy] of candidates) {
    const rendered = report(options, target, inlineDiff, inlinePolicy);
    if (bytes(rendered) <= limit) return rendered;
  }
  throw new Error(`Rootform ${target} framing exceeds its internal byte limit`);
}
