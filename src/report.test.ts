import { describe, expect, test } from "bun:test";
import { REPORT_MARKER, type ReportOptions, renderReport } from "./report.ts";

const options: ReportOptions = {
  artifactUrl: "https://github.com/rootform-dev/action/actions/runs/7/artifacts/11",
  baseSha: "a".repeat(40),
  baselinePath: "before",
  commentState: "Updated",
  currentPath: "after",
  diffExitCode: 1,
  diffMarkdown: "## Rootform diff\n\n| Change | What |\n| --- | --- |\n| added | subnet |\n",
  headSha: "b".repeat(40),
  mode: "source",
  policyExitCode: 0,
  policyMarkdown: "## Rootform check\n\nNo policy violations.\n",
  version: "0.1.0-dev.2",
  workflowUrl: "https://github.com/rootform-dev/action/actions/runs/7",
};

describe("GitHub-native report", () => {
  test("renders deterministic summary", () => {
    const summary = renderReport(options, "summary");
    expect(summary).not.toContain(REPORT_MARKER);
    expect(summary).toStartWith(
      "## Rootform architecture review\n\n`base:aaaaaaa` → `head:bbbbbbb`",
    );
    expect(summary).toContain(
      "> [!WARNING]\n> Architecture changes detected.\n\n| Review gate | Result |",
    );
    expect(summary.indexOf(options.diffMarkdown ?? "missing")).toBeLessThan(
      summary.indexOf(options.policyMarkdown),
    );
    expect(summary).toContain(
      "[Download complete evidence](https://github.com/rootform-dev/action/actions/runs/7/artifacts/11)",
    );
    expect(summary).toContain("- Pull-request comment: Updated");
    expect(summary).toBe(renderReport(options, "summary"));
  });

  test("renders marker-owned comment", () => {
    const comment = renderReport(options, "comment");
    expect(comment).toStartWith(`${REPORT_MARKER}\n\n## Rootform architecture review`);
    expect(Buffer.byteLength(comment, "utf8")).toBeLessThanOrEqual(60_000);
    expect(comment).toContain(options.diffMarkdown ?? "missing");
    expect(comment).toContain(options.policyMarkdown);
  });

  test("bounds GitHub Markdown without partial CLI output", () => {
    const oversizedDiff = `## Rootform diff\n\n${"architecture-row\n".repeat(5_000)}`;
    const comment = renderReport({ ...options, diffMarkdown: oversizedDiff }, "comment");
    expect(comment).not.toContain("architecture-row");
    expect(comment).toContain("Exact CLI Markdown exceeds this GitHub surface's inline limit.");
    expect(comment).toContain(options.policyMarkdown);
    expect(Buffer.byteLength(comment, "utf8")).toBeLessThanOrEqual(60_000);

    const summary = renderReport({ ...options, diffMarkdown: oversizedDiff }, "summary");
    expect(summary).toContain(oversizedDiff);
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(900 * 1024);
  });

  test("derives labels only from documented exits", () => {
    const clean = renderReport(
      {
        ...options,
        baseSha: undefined,
        diffExitCode: 0,
        headSha: undefined,
        policyExitCode: 0,
      },
      "summary",
    );
    expect(clean).toContain("`baseline:before` → `current:after`");
    expect(clean).toContain("Architecture is unchanged and policy checks passed.");
    expect(clean).toContain("| Architecture | ✅ No changes |");
    expect(clean).toContain("| Policies | ✅ Passed |");

    expect(() => renderReport({ ...options, diffExitCode: 2 }, "summary")).toThrow(
      "unsupported diff exit code 2",
    );
    expect(() => renderReport({ ...options, policyExitCode: 3 }, "summary")).toThrow(
      "unsupported policy exit code 3",
    );
  });
});
