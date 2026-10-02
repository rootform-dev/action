import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REPORT_MARKER = "<!-- rootform-action-report:v1 -->";

// Framing reads Markdown structure only. CLI statements and tables stay exact.
function parts(markdown: string): { body: string; provenance: string } {
  let body = markdown.trimEnd();
  let provenance = "";
  const current = body.startsWith("## Rootform\n");
  const legacy = /^## Rootform (architecture|Policies)\n/u.exec(body);
  if (!current && !legacy) return { body, provenance };
  body = body.replace(/^## Rootform[^\n]*\n\n/u, "");
  const boundary = current ? /\n---\n\n### Details\n\n/u : /\n### Provenance\n\n/u;
  const match = boundary.exec(body);
  if (match?.index !== undefined) {
    provenance = body.slice(match.index + match[0].length).trim();
    body = body.slice(0, match.index).trimEnd();
    provenance = provenance
      .replace(/^<details>\n<summary>Provenance<\/summary>\n\n/u, "")
      .replace(/\n<\/details>$/u, "");
  }
  if (legacy) {
    body = body.replace(/^### (Before|After)$/gmu, "#### $1");
    body = body.replace(/^### (.+)$/gmu, "#### $1");
    // Policy identities/outcomes are content, not navigation.
    body = body.replace(
      /^#### (`[^\n]+`|Incomplete coverage|Without target|Not evaluated)$/gmu,
      "**$1**",
    );
    body = `### ${legacy[1] === "Policies" ? "Policies" : "Architecture"}\n\n${body}`;
    body = body.replace(
      /^\*\*((?:Overall verdict: )?(?:VIOLATED|INDETERMINATE|NOT EVALUATED)[^\n]*)\*\*$/gmu,
      (line, words: string) =>
        `> [!${words.includes("VIOLATED") ? "CAUTION" : "WARNING"}]\n> ${line}`,
    );
  }
  return { body, provenance };
}

function compose(documents: string[]): string {
  const blocks = documents.map(parts);
  const bodies = blocks.map((block) => block.body).join("\n\n---\n\n");
  const provenance = blocks
    .filter((block) => block.provenance)
    .map((block) => block.provenance)
    .join("\n\n");
  return `## Rootform\n\n${bodies}${provenance ? `\n\n---\n\n### Details\n\n<details>\n<summary>Provenance</summary>\n\n${provenance}\n\n</details>` : ""}\n`;
}

export function combineReports(paths: string[], directory: string): string | undefined {
  const reports = paths.filter((path) => existsSync(path));
  if (reports.length === 0) return undefined;
  if (reports.length === 1) return reports[0];
  const path = join(directory, "report.md");
  writeFileSync(path, compose(reports.map((file) => readFileSync(file, "utf8"))), { flag: "wx" });
  return path;
}

function omitFoldedDetails(markdown: string, notice: string): string {
  const lines: string[] = [];
  let depth = 0;
  for (const line of markdown.split("\n")) {
    if (line === "<details>") {
      if (depth++ === 0) lines.push(line);
    } else if (line === "</details>" && depth > 0) {
      if (--depth === 0) lines.push("", notice, "", line);
    } else if (depth === 0 || (depth === 1 && line.startsWith("<summary>"))) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

function primaryStatements(markdown: string): string {
  const lines: string[] = [];
  let keeping = true;
  let subsection = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) {
      keeping = true;
      subsection = false;
    }
    if (line.startsWith("#### ")) {
      if (subsection) keeping = false;
      subsection = true;
    }
    if (line === "<details>" || /^\*\*`/u.test(line)) keeping = false;
    if (keeping) lines.push(line);
  }
  return lines.join("\n").trimEnd();
}

export function renderReport(options: {
  version: string;
  markdown?: string;
  workflowUrl?: string;
  artifactUrl?: string;
  commentState?: string;
  limit?: number;
}): string {
  const links = [
    options.workflowUrl ? `[Workflow run](${options.workflowUrl})` : "",
    options.artifactUrl ? `[Download evidence](${options.artifactUrl})` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const footer = `${links ? `\n\n${links}` : ""}${options.commentState ? `\n\nPR report: ${options.commentState}.` : ""}\n`;
  const markdown =
    options.markdown ?? "No CLI report was produced. See the failed step diagnostic.";
  const body = markdown.startsWith("## Rootform\n") ? markdown : compose([markdown]);
  const identity = `## Rootform\n\nCLI \`${options.version}\`.\n\n`;
  const framed = (content: string) =>
    `${identity}${content.replace(/^## Rootform\n\n/u, "").trimEnd()}${footer}`;
  const limit = options.limit ?? 900 * 1024;
  const full = framed(body);
  if (Buffer.byteLength(full, "utf8") <= limit) return full;
  const notice = `Complete details remain available through the report step output${options.artifactUrl ? ` and [evidence artifact](${options.artifactUrl})` : ""}.`;
  const folded = framed(omitFoldedDetails(body, notice));
  if (Buffer.byteLength(folded, "utf8") <= limit) return folded;
  const primary = framed(`${primaryStatements(body)}\n\n${notice}`);
  if (Buffer.byteLength(primary, "utf8") <= limit && /^### (Architecture|Policies)$/mu.test(body))
    return primary;
  return `${identity}CLI report exceeds GitHub's inline size limit. Its complete file remains available through the report step output${options.artifactUrl ? " and evidence artifact" : ""}.${footer}`;
}
