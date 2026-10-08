#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertPublicMessage, publicationIssues } from "../src/publication-safety.ts";

export function trackedPublicationIssues(
  directory: string,
  revision?: string,
): Array<{ path: string; rule: string; line: number }> {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error("Publication refused: cannot read tracked Git content");
    }
  };
  const records = git(
    revision && revision !== ":" ? ["ls-tree", "-r", "-z", revision] : ["ls-files", "-s", "-z"],
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const entries = new Map(
    records.map((entry) => {
      const separator = entry.indexOf("\t");
      return [entry.slice(separator + 1), entry.slice(0, separator).split(" ")[0]] as const;
    }),
  );
  return [...entries].flatMap(([path, mode]) => {
    const full = join(directory, path);
    let body: Buffer;
    if (revision) {
      body = git(["show", `${revision === ":" ? "" : revision}:${path}`]);
      if (mode === "120000") {
        try {
          const target = realpathSync(resolve(directory, dirname(path), body.toString("utf8")));
          if (
            path.startsWith(".claude/skills/") &&
            target.startsWith(`${resolve(directory, ".agents/skills")}/`)
          )
            return [];
        } catch {
          /* Dangling aliases are refused. */
        }
        return [{ path, rule: "symlink", line: 1 }];
      }
      if (mode !== "100644" && mode !== "100755")
        return [{ path, rule: "irregular-entry", line: 1 }];
    } else {
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new Error("Publication refused: cannot inspect tracked entry");
      }
      if (stat.isSymbolicLink()) {
        try {
          const target = realpathSync(full);
          if (
            path.startsWith(".claude/skills/") &&
            target.startsWith(`${resolve(directory, ".agents/skills")}/`)
          )
            return [];
        } catch {
          /* Dangling aliases are refused. */
        }
        return [{ path, rule: "symlink", line: 1 }];
      }
      if (!stat.isFile()) return [{ path, rule: "irregular-entry", line: 1 }];
      try {
        body = readFileSync(full);
      } catch {
        throw new Error("Publication refused: cannot read tracked file");
      }
    }
    // Binary metadata is included; a tracked path is never skipped because it is ignored.
    return publicationIssues(body.toString("utf8")).map((issue) => ({ path, ...issue }));
  });
}

export function checkPublication(args: string[]): void {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const directory = resolve(option("--repo") ?? process.cwd());
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    } catch {
      throw new Error("Publication refused: cannot inspect Git history");
    }
  };
  const message = option("--message-file");
  if (message) assertPublicMessage(readFileSync(message, "utf8"));
  if (args.includes("--metadata-env"))
    assertPublicMessage([process.env.PUBLIC_TITLE ?? "", process.env.PUBLIC_BODY ?? ""]);
  const issues = message
    ? []
    : trackedPublicationIssues(directory, args.includes("--staged") ? ":" : undefined);
  const range = option("--range");
  if (range) {
    for (const commit of git(["rev-list", range]).trim().split("\n").filter(Boolean)) {
      assertPublicMessage(git(["show", "-s", "--format=%B", commit]));
      issues.push(...trackedPublicationIssues(directory, commit));
    }
  }
  const issue = issues[0];
  if (issue) {
    // A malicious filename can itself contain sensitive text.
    const location = publicationIssues(issue.path).length ? "tracked file" : issue.path;
    throw new Error(`Publication refused: ${issue.rule} (${location}:${issue.line})`);
  }
}

if (import.meta.main) {
  try {
    checkPublication(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(
      /^(?:Publication|Public message) refused: /u.test(message)
        ? message
        : "Publication refused: cannot inspect contribution",
    );
    process.exit(1);
  }
}
