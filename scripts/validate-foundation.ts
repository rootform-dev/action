#!/usr/bin/env bun

import { existsSync, lstatSync, readlinkSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { git, nullSeparated, repositoryRoot } from "./lib/git.ts";
import { isForbiddenPackageManagerLock, isPrivateTrackedPath, isSecretPath } from "./lib/policy.ts";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const PRERELEASE = /(?:alpha|beta|canary|dev|next|nightly|preview|rc)/iu;
/* semantic-release expands this template itself; it is a literal contract with
   every consumer that pins a tag, not a JavaScript template string. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release tag template
export const RELEASE_TAG_FORMAT = "v${version}";
export const RELEASE_BRANCH = "main";

export const expectedRootScripts = {
  build: "bun scripts/build.ts",
  check:
    "bun run check:foundation && bun run typecheck && bun run check:format && bun run test:tooling && bun run test:runtime",
  "check:fast": "bun run check",
  "check:format": "biome check .",
  "check:foundation": "bun scripts/validate-foundation.ts",
  format: "biome check --write .",
  "hooks:install": "bun scripts/setup-dev.ts",
  test: "bun run test:tooling && bun run test:runtime",
  "test:runtime": "bun test src",
  "test:tooling": "bun test scripts",
  typecheck: "tsc --noEmit",
  "verify:dist": "bun scripts/verify-dist.ts",
  verify: "bun scripts/verify.ts --full",
} as const;

function isUrlSpec(version: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(version) || version.startsWith("//");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function validateRootManifest(root: string): Promise<string[]> {
  const errors: string[] = [];
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) return ["missing root package.json"];

  let parsed: unknown;
  try {
    parsed = await Bun.file(manifestPath).json();
  } catch (error) {
    return [`invalid root package.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isPlainRecord(parsed)) return ["root package.json must be a JSON object"];
  const manifest = parsed;

  if (manifest.name !== "@rootform/action")
    errors.push(`root name must be @rootform/action, got ${String(manifest.name)}`);
  if (manifest.private !== true) errors.push("root package must be private");
  if (manifest.type !== "module")
    errors.push(`root type must be module, got ${String(manifest.type)}`);
  if (manifest.packageManager !== `bun@${Bun.version}`)
    errors.push(
      `root packageManager must be bun@${Bun.version}, got ${String(manifest.packageManager)}`,
    );
  const engines = manifest.engines as { bun?: unknown } | undefined;
  if (engines?.bun !== Bun.version)
    errors.push(`root engines.bun must equal running pinned Bun version ${Bun.version}`);

  const scripts: unknown = manifest.scripts;
  if (!isPlainRecord(scripts)) {
    errors.push("root scripts must be a plain object");
  } else {
    for (const [script, command] of Object.entries(expectedRootScripts)) {
      if (scripts[script] !== command)
        errors.push(
          `root script ${script} must be exactly "${command}", got ${String(scripts[script])}`,
        );
    }
    for (const script of Object.keys(scripts)) {
      if (!(script in expectedRootScripts))
        errors.push(`unexpected root script: ${script}: ${String(scripts[script])}`);
    }
  }

  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const sectionValue: unknown = manifest[section];
    if (sectionValue === undefined) continue;
    if (!isPlainRecord(sectionValue)) {
      errors.push(`root ${section} must be a dependency object`);
      continue;
    }
    for (const [name, version] of Object.entries(sectionValue)) {
      if (typeof version !== "string") {
        errors.push(`root ${section}.${name} must be a version string`);
        continue;
      }
      if (!EXACT_VERSION.test(version))
        errors.push(`${section}.${name} is not pinned exactly: ${version}`);
      if (PRERELEASE.test(version))
        errors.push(`${section}.${name} uses prerelease version: ${version}`);
      if (isUrlSpec(version))
        errors.push(`CDN or URL dependency spec is forbidden: ${section}.${name}: ${version}`);
    }
  }

  const foreignLocks = ["npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
  for (const lock of foreignLocks) {
    if (existsSync(join(root, lock)))
      errors.push(`foreign package-manager lockfile at repository root: ${lock}`);
  }
  if (isPlainRecord(manifest) && manifest.workspaces !== undefined)
    errors.push("the action repository publishes one package and declares no workspaces");

  return errors;
}

/* A published action is what GitHub reads from a tag: an entrypoint whose
   bundle is committed. A manifest that names a missing bundle, or runs on an
   unpinned runtime, would fail only after a user depends on it. */
export async function validateActionManifests(root: string): Promise<string[]> {
  const errors: string[] = [];
  const manifests = ["action.yml", join("setup", "action.yml")].filter((path) =>
    existsSync(join(root, path)),
  );

  for (const path of manifests) {
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(await Bun.file(join(root, path)).text());
    } catch (error) {
      errors.push(
        `invalid action manifest ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (!isPlainRecord(parsed)) {
      errors.push(`action manifest must be a mapping: ${path}`);
      continue;
    }
    for (const field of ["name", "description"] as const) {
      if (typeof parsed[field] !== "string" || !parsed[field].trim())
        errors.push(`action manifest ${path} needs a non-empty ${field}`);
    }
    const runs: unknown = parsed.runs;
    if (!isPlainRecord(runs)) {
      errors.push(`action manifest ${path} needs a runs section`);
      continue;
    }
    const using = runs.using;
    if (using !== "node24") {
      errors.push(`action manifest ${path} must run on node24, got ${String(using)}`);
    }
    for (const step of ["main", "post", "pre"] as const) {
      const entry = runs[step];
      if (entry === undefined) continue;
      if (typeof entry !== "string") {
        errors.push(`action manifest ${path} ${step} must be a path`);
        continue;
      }
      if (!entry.startsWith("dist/") && !entry.startsWith("../dist/"))
        errors.push(`action manifest ${path} ${step} must run committed bundle output: ${entry}`);
      const bundle = normalize(join(root, dirname(path), entry));
      if (!existsSync(bundle))
        errors.push(`action manifest ${path} ${step} bundle is missing: ${entry}`);
    }
  }

  return errors;
}

/* Releases are what consumers pin to. Automation may create a tag and its
   release from `main`; it may never publish a package, rewrite version fields,
   or push commits back into a protected branch. */
export async function validateReleaseConfiguration(root: string): Promise<string[]> {
  const errors: string[] = [];
  const configPath = join(root, ".releaserc.json");
  if (!existsSync(configPath)) return ["missing release configuration: .releaserc.json"];

  let parsed: unknown;
  try {
    parsed = await Bun.file(configPath).json();
  } catch (error) {
    return [`invalid .releaserc.json: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isPlainRecord(parsed)) return [".releaserc.json must be a JSON object"];

  const branches = parsed.branches;
  if (!Array.isArray(branches) || branches.length !== 1 || branches[0] !== RELEASE_BRANCH)
    errors.push(`release branches must be exactly ["${RELEASE_BRANCH}"]`);
  if (parsed.tagFormat !== RELEASE_TAG_FORMAT)
    errors.push(`release tagFormat must be ${RELEASE_TAG_FORMAT}, got ${String(parsed.tagFormat)}`);

  const plugins = parsed.plugins;
  if (!Array.isArray(plugins)) {
    errors.push("release plugins must be a list");
    return errors;
  }

  const names = plugins.map((plugin) =>
    typeof plugin === "string" ? plugin : Array.isArray(plugin) ? String(plugin[0]) : "",
  );
  const forbidden = ["@semantic-release/npm", "@semantic-release/git", "@semantic-release/exec"];
  for (const name of names) {
    if (forbidden.includes(name))
      errors.push(`release plugin may not publish or rewrite repository state: ${name}`);
  }
  for (const required of ["@semantic-release/commit-analyzer", "@semantic-release/github"]) {
    if (!names.includes(required)) errors.push(`release plugin is missing: ${required}`);
  }

  /* Pre-1.0 stays pre-1.0: a breaking change must raise the minor, because the
     default major bump would publish a v1 nobody accepted. */
  const analyzer = plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/commit-analyzer",
  );
  const analyzerOptions = Array.isArray(analyzer) ? analyzer[1] : undefined;
  const releaseRules = isPlainRecord(analyzerOptions) ? analyzerOptions.releaseRules : undefined;
  const breakingRule = Array.isArray(releaseRules)
    ? releaseRules.find((rule) => isPlainRecord(rule) && rule.breaking === true)
    : undefined;
  if (!isPlainRecord(breakingRule) || breakingRule.release !== "minor")
    errors.push("release rules must map a breaking change to a minor bump while the action is 0.x");

  const manifestPath = join(root, "package.json");
  if (existsSync(manifestPath)) {
    const manifest: unknown = await Bun.file(manifestPath).json();
    const repository = isPlainRecord(manifest) ? manifest.repository : undefined;
    const url = isPlainRecord(repository) ? repository.url : repository;
    if (url !== "git+https://github.com/rootform-dev/action.git")
      errors.push(`root repository.url must name rootform-dev/action, got ${String(url)}`);
  }

  return errors;
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const errors: string[] = [];

  const requiredFiles = [
    ".agents/skills/new-spec/SKILL.md",
    ".agents/skills/technical-spike/SKILL.md",
    ".agents/skills/verify/SKILL.md",
    ".claude/hooks/done-when.ts",
    ".claude/hooks/post-tool-use.ts",
    ".claude/hooks/pre-tool-use.ts",
    ".claude/rules/action-surface.md",
    ".claude/rules/specs.md",
    ".claude/settings.json",
    ".codex/hooks.json",
    ".githooks/commit-msg",
    ".githooks/pre-commit",
    ".githooks/pre-push",
    ".github/CODEOWNERS",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".gitleaks.toml",
    ".releaserc.json",
    "AGENTS.md",
    "CLAUDE.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "bun.lock",
    "docs/adr/002-action-runtime-and-release-assets.md",
    "docs/adr/001-release-automation.md",
    "docs/adr/003-pull-request-reporting-boundary.md",
    "docs/adr/004-ci-dialect-preparation-boundary.md",
    "docs/constitution.md",
    "docs/engineering/go-public.md",
    "docs/engineering/public-private-boundary.md",
    "docs/engineering/quality-gates.md",
    "docs/engineering/toolchain-policy.md",
    "package.json",
    "action.yml",
    "setup/action.yml",
    "scripts/build.ts",
    "scripts/verify-dist.ts",
    "scripts/verify.ts",
    "specs/000-template/plan.md",
    "specs/000-template/spec.md",
    "specs/000-template/tasks.md",
    "specs/001-rootform-action/plan.md",
    "specs/001-rootform-action/spec.md",
    "specs/001-rootform-action/tasks.md",
    "specs/002-pull-request-reporting/plan.md",
    "specs/002-pull-request-reporting/spec.md",
    "specs/002-pull-request-reporting/tasks.md",
    "specs/003-ci-dialect-preparation/plan.md",
    "specs/003-ci-dialect-preparation/spec.md",
    "specs/003-ci-dialect-preparation/tasks.md",
    "src/cache.ts",
    "src/github.ts",
    "src/install.ts",
    "src/main-entry.ts",
    "src/main.ts",
    "src/preparation.ts",
    "src/run.ts",
    "src/setup-entry.ts",
    "src/setup.ts",
  ];

  for (const path of requiredFiles) {
    if (!existsSync(join(root, path))) errors.push(`missing required file: ${path}`);
  }

  function candidatePaths(): string[] {
    const tracked = git(["ls-files", "-z"], root);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
    if (tracked.exitCode !== 0 || untracked.exitCode !== 0) {
      errors.push("cannot enumerate Git candidate paths");
      return [];
    }
    return [...new Set([...nullSeparated(tracked.stdout), ...nullSeparated(untracked.stdout)])]
      .filter((path) => existsSync(join(root, path)))
      .sort();
  }

  const candidates = candidatePaths();
  for (const path of candidates) {
    if (isPrivateTrackedPath(path)) errors.push(`private or sensitive Git candidate: ${path}`);
    if (isForbiddenPackageManagerLock(path))
      errors.push(`foreign package-manager lockfile: ${path}`);
    if (path.endsWith("bun.lockb")) errors.push(`legacy binary Bun lockfile is forbidden: ${path}`);
  }

  const ignoredProbes = [
    ".agents/private/probe.md",
    ".ai-private/probe.md",
    ".claude/settings.local.json",
    ".codex/config.toml",
    ".env",
    ".env.local",
    ".rootform-cli/rootform",
    ".terraform/probe",
    "PROGRESS.local.md",
    "docs/internal/probe.md",
    "prd.md",
    "probe.tfplan",
    "probe.tfstate",
  ];

  for (const path of ignoredProbes) {
    const result = git(["check-ignore", "--quiet", "--no-index", path], root);
    if (result.exitCode !== 0) errors.push(`private probe is not ignored: ${path}`);
  }

  for (const path of [
    ".claude/rules/specs.md",
    ".claude/settings.json",
    ".codex/hooks.json",
    ".env.example",
    "action.yml",
    "bun.lock",
    "dist/main/index.js",
    "dist/setup/index.js",
    "setup/action.yml",
    "src/install.ts",
  ]) {
    const result = git(["check-ignore", "--quiet", "--no-index", path], root);
    if (result.exitCode === 0) errors.push(`public source path is unexpectedly ignored: ${path}`);
  }

  errors.push(...(await validateRootManifest(root)));
  errors.push(...(await validateActionManifests(root)));
  errors.push(...(await validateReleaseConfiguration(root)));

  for (const path of candidates.filter((path) => path.endsWith(".json"))) {
    try {
      await Bun.file(join(root, path)).json();
    } catch (error) {
      errors.push(
        `invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const path of candidates.filter((path) => /\.ya?ml$/u.test(path))) {
    try {
      Bun.YAML.parse(await Bun.file(join(root, path)).text());
    } catch (error) {
      errors.push(
        `invalid YAML ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const path of [
    ".claude/hooks/done-when.ts",
    ".claude/hooks/post-tool-use.ts",
    ".claude/hooks/pre-tool-use.ts",
    ".githooks/commit-msg",
    ".githooks/pre-commit",
    ".githooks/pre-push",
  ]) {
    if (existsSync(join(root, path)) && (statSync(join(root, path)).mode & 0o111) === 0) {
      errors.push(`hook is not executable: ${path}`);
    }
  }

  const rulePaths = candidates.filter(
    (path) => path.startsWith(".claude/rules/") && path.endsWith(".md"),
  );
  const expectedRules = [".claude/rules/action-surface.md", ".claude/rules/specs.md"];
  if (JSON.stringify(rulePaths.sort()) !== JSON.stringify(expectedRules)) {
    errors.push(`shared Claude rules must remain minimal: ${expectedRules.join(", ")}`);
  }

  for (const configPath of [".claude/settings.json", ".codex/hooks.json"]) {
    if (!existsSync(join(root, configPath))) continue;
    const config = await Bun.file(join(root, configPath)).json();
    const events = Object.keys(config.hooks ?? {}).sort();
    if (JSON.stringify(events) !== JSON.stringify(["PostToolUse", "PreToolUse", "Stop"])) {
      errors.push(`${configPath} must expose exactly PreToolUse, PostToolUse, and Stop`);
    }
  }

  for (const path of candidates.filter((path) => /(?:^|\/)SKILL\.md$/u.test(path))) {
    const content = await Bun.file(join(root, path)).text();
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
    if (!frontmatter) {
      errors.push(`missing skill frontmatter: ${path}`);
      continue;
    }
    if (!/^name:\s*[a-z0-9]+(?:-[a-z0-9]+)*$/mu.test(frontmatter))
      errors.push(`invalid skill name: ${path}`);
    if (!/^description:\s*\S.+$/mu.test(frontmatter))
      errors.push(`missing skill description: ${path}`);
    if (/\[TODO|Structuring This Skill/u.test(content))
      errors.push(`unfinished generic skill template: ${path}`);
  }

  function isAbsoluteLike(path: string): boolean {
    return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
  }

  for (const path of candidates.filter((path) => path.startsWith(".claude/skills/"))) {
    const absolute = join(root, path);
    if (!lstatSync(absolute).isSymbolicLink()) {
      errors.push(`Claude skill alias must be a symlink: ${path}`);
      continue;
    }
    const target = readlinkSync(absolute);
    if (isAbsoluteLike(target)) errors.push(`Claude skill alias must be relative: ${path}`);
    const resolved = normalize(resolve(dirname(absolute), target));
    const skillsRoot = normalize(join(root, ".agents", "skills"));
    if (resolved !== skillsRoot && !resolved.startsWith(`${skillsRoot}/`)) {
      errors.push(`Claude skill alias escapes .agents/skills: ${path}`);
    }
    if (!existsSync(resolved)) errors.push(`broken Claude skill alias: ${path}`);
  }

  for (const path of candidates.filter((path) => /^\.github\/workflows\/.*\.ya?ml$/u.test(path))) {
    const content = await Bun.file(join(root, path)).text();
    for (const match of content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gmu)) {
      const reference = match[1];
      if (!reference || reference.startsWith("./") || reference.startsWith("docker://")) continue;
      const ref = reference.split("@")[1];
      if (!ref || !/^[0-9a-f]{40}$/u.test(ref))
        errors.push(`GitHub Action is not SHA-pinned in ${path}: ${reference}`);
    }
    if (/pull_request_target\s*:/u.test(content))
      errors.push(`pull_request_target is forbidden: ${path}`);
    if (/permissions:\s*write-all/u.test(content))
      errors.push(`write-all workflow permission is forbidden: ${path}`);
  }

  for (const path of candidates) {
    const absolute = join(root, path);
    if (
      !existsSync(absolute) ||
      lstatSync(absolute).isDirectory() ||
      lstatSync(absolute).isSymbolicLink()
    )
      continue;
    const file = Bun.file(absolute);
    if (file.size > 1_048_576) continue;
    const content = await file.text();
    if (
      /\/Users\/[A-Za-z0-9._-]+\//u.test(content) ||
      /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/u.test(content)
    ) {
      errors.push(`absolute personal path in public candidate: ${path}`);
    }
    if (isSecretPath(path)) errors.push(`secret path cannot be public: ${path}`);
  }

  if (errors.length > 0) {
    console.error(`Foundation validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Foundation validation passed (${candidates.length} Git candidate paths).`);
}

if (import.meta.main) {
  await main();
}
