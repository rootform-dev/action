import { describe, expect, test } from "bun:test";
import {
  GENERATED_LOCK_MESSAGE,
  REPORT_MARKER,
  type ReportOptions,
  renderReport,
} from "./report.ts";

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
    const committed = renderReport(
      {
        ...options,
        preparation: {
          dialects: [
            { name: "aws", version: "0.1.0" },
            { name: "core", version: "0.1.0" },
          ],
          lockCreated: false,
          lockPath: "infra/rootform.lock",
          resolutionMode: "locked-offline",
          unsupportedProviders: [],
        },
      },
      "summary",
    );
    expect(committed).toContain("<summary><strong>Dialect preparation</strong></summary>");
    expect(committed).toContain("- Resolution mode: `locked-offline`");
    expect(committed).toContain("- Dialects: `aws@0.1.0`, `core@0.1.0`");
    expect(committed).toContain("- Project lock: Committed at `infra/rootform.lock`");
    expect(committed).not.toContain(GENERATED_LOCK_MESSAGE);
    expect(committed).toBe(
      renderReport(
        {
          ...options,
          preparation: {
            dialects: [
              { name: "aws", version: "0.1.0" },
              { name: "core", version: "0.1.0" },
            ],
            lockCreated: false,
            lockPath: "infra/rootform.lock",
            resolutionMode: "locked-offline",
            unsupportedProviders: [],
          },
        },
        "summary",
      ),
    );

    const generated = renderReport(
      {
        ...options,
        preparation: {
          dialects: [],
          lockCreated: true,
          lockPath: "rootform.lock",
          resolutionMode: "default",
          unsupportedProviders: ["registry.terraform.io/vancluever/acme"],
        },
      },
      "comment",
    );
    expect(generated).toContain(`> [!IMPORTANT]\n> ${GENERATED_LOCK_MESSAGE}`);
    expect(generated).toContain("- Dialects: None required");
    expect(generated).toContain("- Project lock: Generated for this run");
    expect(generated).toContain(
      "- Providers without an official dialect: `registry.terraform.io/vancluever/acme`",
    );

    /* Preparation presentation carries dialect identity and lock state only: no
       runner path, no environment value, no raw Terraform material, and no
       credential can reach a GitHub surface through it. */
    for (const rendered of [committed, generated]) {
      expect(rendered).not.toContain(runnerHome);
      expect(rendered).not.toContain("ROOTFORM_HOME");
      expect(rendered).not.toContain("/home/runner");
      expect(rendered).not.toContain("_temp");
      expect(rendered).not.toMatch(/(?:^|[\s`(])\/[A-Za-z0-9._-]+\//u);
      expect(rendered).not.toContain('resource "');
      expect(rendered).not.toContain("ghp_");
    }
  });
});
