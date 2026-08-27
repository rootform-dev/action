import { join } from "node:path";
import { git } from "./git.ts";

export type SpecValidation = {
  errors: string[];
  id?: string;
};

const PLACEHOLDER = /<[^>]+>|\b(?:Pending|YYYY-MM-DD|SPEC-NNN|REQ-NNN)\b/u;
const CIRCULAR_DONE_WHEN = /^(?:`?)?(?:it )?(?:works|looks correct|tests pass|done)(?:`?)?\.?$/iu;

export function validateAcceptedSpec(content: string): SpecValidation {
  const errors: string[] = [];
  const titleMatch = content.match(/^# SPEC-(\d{3}):\s+\S.+$/mu);
  const status = content.match(/^- Status:\s*(.+)$/mu)?.[1]?.trim();
  const ownerApproval = content.match(/^- Owner approval:\s*(.+)$/mu)?.[1]?.trim();

  if (!titleMatch) errors.push("title must use '# SPEC-NNN: title'");
  if (status !== "Accepted") errors.push("Status must be Accepted");
  if (!ownerApproval || ownerApproval === "Pending") {
    errors.push("dated owner approval is required");
  } else if (!/@[A-Za-z0-9-]+.*\b\d{4}-\d{2}-\d{2}\b/u.test(ownerApproval)) {
    errors.push("owner approval must include @identity and ISO date");
  }
  if (PLACEHOLDER.test(content)) errors.push("accepted spec contains unresolved placeholder");

  const requirementMatches = [...content.matchAll(/^### (REQ-\d{3})\s+—\s+.+$/gmu)];
  if (requirementMatches.length === 0) errors.push("at least one REQ-NNN requirement is required");

  const seen = new Set<string>();
  for (const [index, requirement] of requirementMatches.entries()) {
    const id = requirement[1];
    if (!id) continue;
    if (seen.has(id)) errors.push(`${id} is duplicated`);
    seen.add(id);

    const start = requirement.index ?? 0;
    const end = requirementMatches[index + 1]?.index ?? content.length;
    const section = content.slice(start, end);
    const acceptance = section.match(/^- Acceptance:\s*(.+)$/mu)?.[1]?.trim();
    const doneWhen = section.match(/^- Done when:\s*(.+)$/mu)?.[1]?.trim();
    const evidence = section.match(/^- Evidence:\s*(.+)$/mu)?.[1]?.trim();

    if (!acceptance || !/\bWHEN\b.+\b(?:SHALL|MUST)\b/iu.test(acceptance)) {
      errors.push(`${id} acceptance must contain observable EARS WHEN/SHALL language`);
    }
    if (!doneWhen || PLACEHOLDER.test(doneWhen) || CIRCULAR_DONE_WHEN.test(doneWhen)) {
      errors.push(`${id} needs exact, non-circular Done when proof`);
    }
    if (!evidence || PLACEHOLDER.test(evidence) || /^Pending$/iu.test(evidence)) {
      errors.push(`${id} needs an evidence path or artifact`);
    }
  }

  return { errors, id: titleMatch?.[1] };
}

export function specIdFromBranch(branch: string): string | undefined {
  return branch.match(
    /^(?:build|chore|ci|docs|feat|fix|perf|refactor|style|test)\/(\d{3})-[a-z0-9][a-z0-9-]*$/u,
  )?.[1];
}

export async function validateProductChangeGate(
  root: string,
  changedPaths: string[],
  branchOverride?: string,
): Promise<string[]> {
  if (changedPaths.length === 0) return [];

  const branchResult = branchOverride ? undefined : git(["branch", "--show-current"], root);
  if (branchResult && branchResult.exitCode !== 0) return ["cannot resolve current branch"];
  const branch = branchOverride || branchResult?.stdout.trim() || "";
  const specId = specIdFromBranch(branch);
  if (!specId)
    return [
      `product changes require branch type/NNN-short-slug; current branch: ${branch || "detached"}`,
    ];

  const glob = new Bun.Glob(`specs/${specId}-*/spec.md`);
  const matches = [...glob.scanSync({ cwd: root, onlyFiles: true })];
  if (matches.length !== 1)
    return [`expected exactly one accepted spec matching specs/${specId}-*/spec.md`];

  const specPath = matches[0];
  if (!specPath) return [`missing spec for ${specId}`];
  const result = validateAcceptedSpec(await Bun.file(join(root, specPath)).text());
  return result.errors.map((error) => `${specPath}: ${error}`);
}
