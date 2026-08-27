import { isAbsolute, relative } from "node:path";

export type HookInput = {
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  tool_input?: Record<string, unknown>;
  tool_name?: string;
};

export type PolicyDecision = { allow: true } | { allow: false; reason: string };

const SECRET_TEMPLATE_NAMES = new Set([
  ".dev.vars.example",
  ".env.example",
  ".env.sample",
  ".env.template",
]);

const PRIVATE_PREFIXES = [
  ".ai-private/",
  ".agents/memory/",
  ".agents/private/",
  ".agents/scratch/",
  ".claude/agent-memory/",
  ".claude/agents/",
  ".claude/debug/",
  ".claude/plans/",
  ".claude/tasks/",
  ".claude/worktrees/",
  ".codex-log/",
  "docs/internal/",
  "specs/private/",
];

const GENERATED_PREFIXES = ["coverage/", "dist/", "node_modules/"];

const FORBIDDEN_PACKAGE_MANAGER_LOCKS = new Set([
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const DESTRUCTIVE_COMMANDS: Array<[RegExp, string]> = [
  [/\bgit\s+reset\s+--hard\b/iu, "git reset --hard rewrites the working tree"],
  [/\bgit\s+clean\s+-[^\n;]*f/iu, "git clean with force deletes untracked files"],
  [/\bgit\s+push\b[^\n;]*(?:--force(?:-with-lease)?|-f\b)/iu, "force push rewrites shared history"],
  [/\bgit\s+(?:rebase|filter-branch|filter-repo)\b/iu, "history rewriting requires owner approval"],
  [/\bgit\s+commit\b[^\n;]*--amend\b/iu, "commit amendment rewrites history"],
  [/\bgit\s+checkout\s+--\s/iu, "git checkout -- discards working-tree changes"],
  [/\bgit\s+restore\b(?![^\n;]*--staged)/iu, "git restore can discard working-tree changes"],
  [/\b(?:rm|unlink)\b[^\n;]*(?:-[a-z]*r[a-z]*|--recursive)/iu, "recursive deletion is blocked"],
  [
    /\bterraform\s+(?:apply|destroy|import|taint|untaint|state|force-unlock)\b/iu,
    "mutating Terraform commands are forbidden",
  ],
  [/\bgh\s+repo\s+delete\b/iu, "repository deletion requires direct owner action"],
  [
    /\bgh\s+release\s+(?:create|delete|edit|upload)\b/iu,
    "publishing or changing a release is an owner action",
  ],
  [
    /\bgit\s+tag\b[^\n;]*(?:-d\b|--delete\b|-f\b|--force\b)/iu,
    "moving or deleting a published tag breaks every workflow pinned to it",
  ],
  [
    /\bgh\s+api\b[^\n;]*(?:-X|--method)\s*DELETE\b/iu,
    "destructive GitHub API calls require direct owner action",
  ],
  [/--no-verify\b/iu, "verification bypass is forbidden"],
];

const FOREIGN_PACKAGE_MANAGER =
  /(?:^|[;&|()]|\$\()\s*(?:sudo\s+)?(?:npm|npx|pnpm|yarn|bunx|bun\s+x)(?:\s|$)/iu;
const WRITE_COMMAND = /(?:>>?|\b(?:cp|install|mv|rm|sed\s+-i|perl\s+-pi|tee|touch|truncate)\b)/iu;

export function normalizeRepositoryPath(path: string, root: string): string {
  const normalized = path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^['"]|['"]$/g, "");
  const relativePath = isAbsolute(normalized)
    ? relative(root, normalized)
    : normalized.replace(/^\.\//, "");
  return relativePath.replaceAll("\\", "/").replace(/\/+/g, "/");
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function isSecretPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (SECRET_TEMPLATE_NAMES.has(name)) return false;

  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".dev.vars" ||
    name.startsWith(".dev.vars.") ||
    name === "credentials.tfrc.json" ||
    /\.(?:key|p12|pfx|pem|tfplan|tfstate)(?:\..*)?$/iu.test(name) ||
    path.split("/").includes(".terraform")
  );
}

export function isPrivateTrackedPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  const name = basename(normalized);

  return (
    normalized === "prd.md" ||
    normalized === "CLAUDE.local.md" ||
    normalized === "PROGRESS.local.md" ||
    normalized === "ROADMAP.local.md" ||
    normalized === ".claude/settings.local.json" ||
    normalized === ".mcp.json" ||
    normalized === ".mcp.local.json" ||
    normalized === ".codex/config.toml" ||
    (normalized.startsWith(".codex/") && normalized !== ".codex/hooks.json") ||
    PRIVATE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    name.endsWith(".private.md") ||
    isSecretPath(normalized)
  );
}

export function isForbiddenPackageManagerLock(path: string): boolean {
  return FORBIDDEN_PACKAGE_MANAGER_LOCKS.has(basename(path));
}

export function isProtectedWritePath(path: string): string | undefined {
  const normalized = path.replace(/^\.\//, "");
  const name = basename(normalized).toLowerCase();

  if (normalized === ".." || normalized.startsWith("../"))
    return "writes outside repository are blocked";
  if (isSecretPath(normalized)) return "agents never write secret or Terraform runtime files";
  if (normalized === "prd.md") return "private PRD is owner-controlled";
  if (normalized === "docs/constitution.md")
    return "constitution changes require explicit owner review";
  if (["license", "license.md", "license.txt", "copying"].includes(name))
    return "license changes require explicit owner review";
  if (name === "bun.lock") return "generated lockfiles must be changed by owning tool";
  if (isForbiddenPackageManagerLock(normalized)) return "Bun is sole JavaScript package manager";
  if (GENERATED_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
    return "generated or dependency output is not hand-edited";

  return undefined;
}

export function extractToolPaths(input: HookInput, root: string): string[] {
  const toolInput = input.tool_input ?? {};
  const rawPaths = new Set<string>();

  for (const key of ["file_path", "path"] as const) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) rawPaths.add(value);
  }

  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  for (const match of command.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gmu)) {
    if (match[1]) rawPaths.add(match[1].trim());
  }

  return [...rawPaths].map((path) => normalizeRepositoryPath(path, root));
}

function commandMentionsProtectedWrite(command: string): string | undefined {
  if (!WRITE_COMMAND.test(command)) return undefined;

  const protectedNames = [
    "prd.md",
    "docs/constitution.md",
    "bun.lock",
    "license",
    ".env",
    ".dev.vars",
    ".tfstate",
    ".tfplan",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ];

  return protectedNames.find((name) => command.toLowerCase().includes(name));
}

export function decidePreToolUse(input: HookInput, root: string): PolicyDecision {
  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  const paths = extractToolPaths(input, root);

  if (/^(?:Read|Glob|Grep)$/u.test(toolName)) {
    const secret = paths.find(isSecretPath);
    return secret
      ? { allow: false, reason: `sensitive file read blocked: ${secret}` }
      : { allow: true };
  }

  if (/^(?:Edit|Write|apply_patch)$/u.test(toolName)) {
    for (const path of paths) {
      const reason = isProtectedWritePath(path);
      if (reason) return { allow: false, reason: `${reason}: ${path}` };
    }
    return { allow: true };
  }

  if (toolName === "Bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    for (const [pattern, reason] of DESTRUCTIVE_COMMANDS) {
      if (pattern.test(command)) return { allow: false, reason };
    }
    if (FOREIGN_PACKAGE_MANAGER.test(command)) {
      return {
        allow: false,
        reason: "Bun is sole JavaScript package manager; unpinned bunx is also blocked",
      };
    }
    if (
      [...command.matchAll(/(?:^|[\s'"=])([^\s'";|]+)/gu)].some((match) =>
        isSecretPath(match[1] ?? ""),
      )
    ) {
      return {
        allow: false,
        reason: "shell access to secret or Terraform runtime paths is blocked",
      };
    }
    const protectedName = commandMentionsProtectedWrite(command);
    if (protectedName)
      return { allow: false, reason: `shell write to governed file is blocked: ${protectedName}` };
  }

  return { allow: true };
}

export function isProductPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  if (["action.yml", "action.yaml"].includes(normalized)) return true;
  return ["dist/", "setup/", "src/", "test/"].some((prefix) => normalized.startsWith(prefix));
}
