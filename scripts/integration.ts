#!/usr/bin/env bun
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installRootform } from "../src/install.ts";
import { type BusinessKind, type RunOptions, runBusiness } from "../src/run.ts";

const fixtures = process.env.ROOTFORM_TEST_FIXTURES;
if (!fixtures)
  throw new Error("ROOTFORM_TEST_FIXTURES must name the public Rootform fixture checkout");
const version = process.env.ROOTFORM_TEST_VERSION;
if (!version) throw new Error("ROOTFORM_TEST_VERSION must name an exact published CLI version");
const workspace = resolve(fixtures);
const temporary = mkdtempSync(join(tmpdir(), "rootform-action-integration-"));
process.env.RUNNER_TOOL_CACHE ||= join(temporary, "tools");
process.env.ROOTFORM_HOME = join(temporary, "home");
mkdirSync(process.env.ROOTFORM_HOME);
process.env.GITHUB_PATH ||= join(temporary, "github-path");
writeFileSync(process.env.GITHUB_PATH, "");
const installation = await installRootform({
  version,
  token: process.env.ROOTFORM_TEST_TOKEN || "",
});
const baseProject = join(workspace, "examples/playground/shared-data-platform/base");
const headProject = join(workspace, "examples/playground/shared-data-platform/head");
const baseline = join(workspace, "policy-packs/baseline");
const negative = join(temporary, "negative");
mkdirSync(negative);
writeFileSync(
  join(negative, "pack.rf.hcl"),
  'policy_pack "qualification" {\n  version = "0.1.0"\n}\n',
);
writeFileSync(
  join(negative, "deny.rf.hcl"),
  'policy "deny-database" {\n  target { concept = rf.concept.managed-database }\n  assert = false\n  message = "Synthetic integration violation."\n}\n',
);
const evidence: object[] = [];
function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function run(name: string, kind: BusinessKind, values: Partial<RunOptions>, expected = 0) {
  const directory = join(temporary, name);
  mkdirSync(directory);
  const result = runBusiness({
    ...installation,
    binary: installation.binary,
    kind,
    workspace,
    project: baseProject,
    locked: false,
    policies: [],
    policyPacks: [],
    check: false,
    outputDirectory: directory,
    ...values,
  });
  assert.equal(
    result.exitCode ??
      (result.failure && "exitCode" in result.failure ? result.failure.exitCode : 0),
    expected,
    `${name}: unexpected CLI status`,
  );
  if (expected === 0)
    assert.equal(result.failure, undefined, `${name}: ${result.failure?.message}`);
  assert.ok(result.paths.form, `${name}: missing Form`);
  for (const path of Object.values(result.paths)) assert.ok(path && statSync(path).size > 0);
  if (result.paths.report) {
    const report = readFileSync(result.paths.report, "utf8");
    assert.ok(!report.includes("Each list above shows at most"), `${name}: compact CLI preview`);
    assert.ok(
      !/\d+ of \d+ (?:entries|evaluations) shown/u.test(report),
      `${name}: incomplete Markdown list`,
    );
  }
  evidence.push({
    name,
    exitCode: result.exitCode ?? null,
    outputs: Object.fromEntries(
      Object.entries(result.paths).map(([key, path]) => [
        key,
        { bytes: statSync(path as string).size, sha256: digest(path as string) },
      ]),
    ),
  });
  return result;
}
const analyzed = run("analyze", "analyze", {
  input: join(baseProject, "plan.json"),
  planFile: join(baseProject, "plan.tfplan"),
});
const original = digest(analyzed.paths.form as string);
const reopened = run("reopen", "analyze", { input: analyzed.paths.form });
assert.equal(reopened.paths.form, analyzed.paths.form);
assert.equal(digest(reopened.paths.form as string), original);
const compared = run("compare", "compare", {
  before: analyzed.paths.form,
  after: join(headProject, "plan.json"),
  afterPlanFile: join(headProject, "plan.tfplan"),
});
const comparisonDigest = digest(compared.paths.form as string);
const reopenedComparison = run("reopen-comparison", "analyze", { input: compared.paths.form });
assert.equal(reopenedComparison.paths.form, compared.paths.form);
assert.equal(digest(reopenedComparison.paths.form as string), comparisonDigest);
const rejectedDirectory = join(temporary, "reject-comparison-operand");
mkdirSync(rejectedDirectory);
const rejected = runBusiness({
  binary: installation.binary,
  kind: "compare",
  workspace,
  project: baseProject,
  locked: false,
  policies: [],
  policyPacks: [],
  check: false,
  before: compared.paths.form,
  after: analyzed.paths.form,
  outputDirectory: rejectedDirectory,
});
assert.ok(rejected.failure && "exitCode" in rejected.failure);
assert.equal(rejected.failure.exitCode, 2);
assert.equal(rejected.paths.form, undefined);
evidence.push({ name: "reject-comparison-operand", exitCode: 2, outputs: {} });
run("check-direct", "check", {
  input: join(baseProject, "plan.json"),
  planFile: join(baseProject, "plan.tfplan"),
  policyPacks: [baseline],
});
run("check-comparison", "check", {
  input: compared.paths.form,
  side: "both",
  policyPacks: [baseline],
});
run("violation", "check", { input: analyzed.paths.form, policyPacks: [negative] }, 1);
run("undecided", "check", { input: analyzed.paths.form, policyPacks: [] }, 3);
run("state", "analyze", { input: join(workspace, "cli/detect/testdata/state.json") });
const output = process.env.ROOTFORM_TEST_EVIDENCE;
if (output)
  writeFileSync(
    output,
    `${JSON.stringify({ version: installation.version, executableSha256: installation.sha256, cases: evidence }, null, 2)}\n`,
  );
console.log(
  `Published CLI integration passed (${evidence.length} cases, ${installation.version}).`,
);
