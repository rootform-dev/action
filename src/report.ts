import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REPORT_MARKER = "<!-- rootform-action-report:v1 -->";

export function combineReports(paths: string[], directory: string): string | undefined {
  const reports = paths.filter((path) => existsSync(path));
  if (reports.length === 0) return undefined;
  if (reports.length === 1) return reports[0];
  const path = join(directory, "report.md");
  writeFileSync(
    path,
    reports
      .map(
        (file, index) =>
          `## ${index === 0 ? "Architecture" : "Policies"}\n\n${readFileSync(file, "utf8").trimEnd()}\n`,
      )
      .join("\n"),
    { flag: "wx" },
  );
  return path;
}

export function renderReport(options: {
  version: string;
  markdown?: string;
  workflowUrl?: string;
  artifactUrl?: string;
  commentState?: string;
  limit?: number;
}): string {
  const identity = `# Rootform\n\nCLI \`${options.version}\`.\n\n`;
  const links = [
    options.workflowUrl ? `[Workflow run](${options.workflowUrl})` : "",
    options.artifactUrl ? `[Download evidence](${options.artifactUrl})` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const footer = `${links ? `\n\n${links}` : ""}${options.commentState ? `\n\nPR report: ${options.commentState}.` : ""}\n`;
  const markdown =
    options.markdown ?? "No CLI report was produced. See the failed step diagnostic.";
  const full = `${identity}${markdown.trimEnd()}${footer}`;
  if (Buffer.byteLength(full, "utf8") <= (options.limit ?? 900 * 1024)) return full;
  return `${identity}CLI report exceeds GitHub's inline size limit. Its complete file remains available through the report step output${options.artifactUrl ? " and evidence artifact" : ""}.${footer}`;
}
