import { assertPublicMessage } from "../../src/publication-safety.ts";
import { validateCommitSubject } from "./commit-message.ts";

export type PullRequestValidation = { errors: string[] };

export function validatePullRequestMetadata(title: string, body: string): PullRequestValidation {
  const errors: string[] = [];
  try {
    assertPublicMessage([title, body]);
  } catch {
    return { errors: ["unsafe public contribution text"] };
  }
  const titleResult = validateCommitSubject(title);
  if (!titleResult.valid) errors.push(`title: ${titleResult.reason}`);
  for (const heading of ["Change", "Validation"]) {
    const section = body.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "mu"));
    if (!section?.[1]?.trim()) errors.push(`missing pull request section: ${heading}`);
  }
  if (
    /\b(?:TODO|TBD|Pending)\b|<!--\s*required:|Describe the outcome and|List commands and results/u.test(
      body,
    )
  )
    errors.push("pull request body contains unresolved placeholder");
  return { errors };
}
