import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combineReports, renderReport } from "./report.ts";

test("forwards exact CLI Markdown without adding derived counts", () => {
  const markdown = "## Rootform check\n\nNo policy findings.\n";

  expect(renderReport({ version: "0.1.0", markdown })).toBe(
    "# Rootform\n\nCLI `0.1.0`.\n\n## Rootform check\n\nNo policy findings.\n",
  );
});

test("combines CLI reports with section framing while preserving their content", () => {
  const directory = mkdtempSync(join(tmpdir(), "rootform-report-test-"));
  const analysisPath = join(directory, "analysis.md");
  const policyPath = join(directory, "policy.md");
  const analysis =
    "# CLI analysis\n\nExact analysis table:\n\n| Name | Result |\n| --- | --- |\n| subnet | present |\n";
  const policy = "# CLI check\n\nNo policy findings.\n";

  try {
    writeFileSync(analysisPath, analysis);
    writeFileSync(policyPath, policy);

    const combinedPath = combineReports([analysisPath, policyPath], directory);

    expect(combinedPath).toBe(join(directory, "report.md"));
    if (!combinedPath) throw new Error("Combined report missing");
    expect(readFileSync(combinedPath, "utf8")).toBe(
      `## Architecture\n\n${analysis.trimEnd()}\n\n## Policies\n\n${policy.trimEnd()}\n`,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("omits an oversized CLI report whole and preserves evidence links", () => {
  const markdown = `CLI-BODY-BEGIN\n${"oversized-row\n".repeat(2_000)}CLI-BODY-END`;
  const rendered = renderReport({
    version: "1.2.3",
    markdown,
    workflowUrl: "https://github.com/rootform-dev/action/actions/runs/7",
    artifactUrl: "https://github.com/rootform-dev/action/actions/runs/7/artifacts/11",
    limit: 500,
  });

  expect(rendered).toContain("CLI report exceeds GitHub's inline size limit.");
  expect(rendered).toContain(
    "complete file remains available through the report step output and evidence artifact",
  );
  expect(rendered).toContain(
    "[Workflow run](https://github.com/rootform-dev/action/actions/runs/7)",
  );
  expect(rendered).toContain(
    "[Download evidence](https://github.com/rootform-dev/action/actions/runs/7/artifacts/11)",
  );
  expect(rendered).not.toContain("CLI-BODY-BEGIN");
  expect(rendered).not.toContain("oversized-row");
  expect(rendered).not.toContain("CLI-BODY-END");
});
