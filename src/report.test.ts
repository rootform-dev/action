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

  test("renders preparation without runner paths", () => {
    const runnerHome = "/home/runner/work/_temp/rootform-home-a1b2c3";
    const prepared = renderReport(
      {
        ...options,
        preparation: {
          downloadedBytes: 128,
          dialects: [{ name: "acme", status: "acquired", version: "0.1.0" }],
          lockPath: "infra/rootform.lock",
          policyPacks: [{ name: "baseline", status: "verified", version: "0.1.0" }],
          preparationMode: "locked-offline",
        },
      },
      "summary",
    );
    expect(prepared).toContain(
      "<summary><strong>Dialect and Policy Pack preparation</strong></summary>",
    );
    expect(prepared).toContain("- Preparation mode: `locked-offline`");
    expect(prepared).toContain("- Dialects: `acme@0.1.0` (acquired)");
    expect(prepared).toContain("- Policy Packs: `baseline@0.1.0` (verified)");
    expect(prepared).toContain("- Downloaded bytes: 128");
    expect(prepared).toContain("- Project lock: Present at `infra/rootform.lock`");
    expect(prepared).toBe(
      renderReport(
        {
          ...options,
          preparation: {
            downloadedBytes: 128,
            dialects: [{ name: "acme", status: "acquired", version: "0.1.0" }],
            lockPath: "infra/rootform.lock",
            policyPacks: [{ name: "baseline", status: "verified", version: "0.1.0" }],
            preparationMode: "locked-offline",
          },
        },
        "summary",
      ),
    );

    const empty = renderReport(
      {
        ...options,
        preparation: {
          downloadedBytes: 0,
          dialects: [],
          policyPacks: [],
          preparationMode: "offline",
        },
      },
      "comment",
    );
    expect(empty).toContain("- Dialects: None selected");
    expect(empty).toContain("- Policy Packs: None selected");
    expect(empty).toContain("- Downloaded bytes: 0");
    expect(empty).toContain("- Project lock: Not present");

    /* Preparation presentation carries external package identity and lock path
       only: no source, runner path, environment, Terraform, or credential. */
    for (const rendered of [prepared, empty]) {
      expect(rendered).not.toContain(runnerHome);
      expect(rendered).not.toContain("registry.example/acme");
      expect(rendered).not.toContain("local:policies/baseline");
      expect(rendered).not.toContain("ROOTFORM_HOME");
      expect(rendered).not.toContain("/home/runner");
      expect(rendered).not.toContain("_temp");
      expect(rendered).not.toMatch(/(?:^|[\s`(])\/[A-Za-z0-9._-]+\//u);
      expect(rendered).not.toContain('resource "');
      expect(rendered).not.toContain("ghp_");
    }
  });
});
