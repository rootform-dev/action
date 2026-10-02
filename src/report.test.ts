import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combineReports, renderReport } from "./report.ts";

test("forwards exact CLI Markdown without adding derived counts", () => {
  const markdown = "## Rootform check\n\nNo policy findings.\n";

  expect(renderReport({ version: "0.1.0", markdown })).toBe(
    "## Rootform\n\nCLI `0.1.0`.\n\n## Rootform check\n\nNo policy findings.\n",
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
      `## Rootform\n\n${analysis.trimEnd()}\n\n---\n\n${policy.trimEnd()}\n`,
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

test("current CLI composition keeps one identity and audit details after both result blocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "rootform-current-review-"));
  const architecture =
    "## Rootform\n\n### Architecture\n\n**76 instances added.**\n\n#### Planned changes\n\n| Change | Instances |\n| --- | ---: |\n| + Added | 76 |\n\n---\n\n### Details\n\n<details>\n<summary>Provenance</summary>\n\n- **Input:** `form.json`\n\n</details>\n";
  const policies =
    "## Rootform\n\n### Policies\n\n> [!CAUTION]\n> **Verdict: VIOLATED**\n\n#### Planned architecture\n\n1 evaluation violated.\n\n---\n\n### Details\n\n<details>\n<summary>Provenance</summary>\n\n- **Origin:** Plan\n\n</details>\n";
  try {
    const a = join(dir, "analysis.md"),
      p = join(dir, "check.md");
    writeFileSync(a, architecture);
    writeFileSync(p, policies);
    const path = combineReports([a, p], dir);
    if (!path) throw new Error("missing report");
    const report = readFileSync(path, "utf8");
    expect(report.match(/^## Rootform$/gmu)).toHaveLength(1);
    expect(report.match(/^### /gmu)).toHaveLength(3);
    expect(report.match(/^---$/gmu)).toHaveLength(2);
    expect(report.indexOf("### Policies")).toBeLessThan(report.indexOf("### Details"));
    expect(report).toContain("| + Added | 76 |");
    expect(report).toContain("> **Verdict: VIOLATED**");
    expect(report).toContain("- **Origin:** Plan");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("oversize exhaustive details shrink inline while CLI verdict and counts remain", () => {
  const markdown = `## Rootform\n\n### Policies\n\n> [!CAUTION]\n> **Verdict: VIOLATED**\n\n#### Planned architecture\n\n1 Policy selected. 1200 evaluations violated.\n\n<details>\n<summary>Violated: 1200 evaluations</summary>\n\n${"- `object.resource`\n".repeat(1200)}\n</details>\n`;
  const rendered = renderReport({
    version: "0.1.0",
    markdown,
    artifactUrl: "https://github.com/rootform-dev/action/actions/runs/7/artifacts/11",
    limit: 1000,
  });
  expect(Buffer.byteLength(rendered)).toBeLessThanOrEqual(1000);
  expect(rendered).toContain("> **Verdict: VIOLATED**");
  expect(rendered).toContain("1200 evaluations violated.");
  expect(rendered).toContain("<summary>Violated: 1200 evaluations</summary>");
  expect(rendered).toContain("Complete details remain available");
  expect(markdown.match(/object.resource/gu)).toHaveLength(1200);
});

test("legacy check framing preserves evaluated sides without status headings", () => {
  const markdown =
    "## Rootform Policies\n\n**Overall verdict: INDETERMINATE**\n\n### Before\n\n#### `sample.policy.requirement`\n\n**Indeterminate: 1 evaluation**\n\n### After\n\nAll evaluations passed.\n\n### Provenance\n\n- **Input:** `comparison.json`\n";
  const rendered = renderReport({ version: "0.1.0", markdown });
  expect(rendered).toContain("### Policies\n\n> [!WARNING]");
  expect(rendered).toContain("#### Before");
  expect(rendered).toContain("**`sample.policy.requirement`**");
  expect(rendered).toContain("### Details");
  expect(rendered).not.toContain("#####");
});
