import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function containedInput(
  workspace: string,
  input: string,
  kind: "directory" | "file",
  label: string,
  temporary?: string,
): string {
  if (!input || /[\r\n\0]/u.test(input))
    throw new Error(`${label} requires one file or directory path`);
  const path = resolve(workspace, input);
  const roots = [workspace, ...(kind === "file" && temporary ? [temporary] : [])].map((root) =>
    realpathSync(root),
  );
  if (!existsSync(path)) throw new Error(`${label} does not exist`);
  const stat = lstatSync(path);
  const actual = realpathSync(path);
  if (stat.isSymbolicLink() || !roots.some((root) => inside(root, actual)))
    throw new Error(`${label} must remain inside workspace or runner temporary storage`);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory())
    throw new Error(`${label} must be a ${kind}`);
  return actual;
}
