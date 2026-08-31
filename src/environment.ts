const FORBIDDEN_CLI_VARIABLES = new Set([
  "GITHUB_TOKEN",
  "INPUT_GITHUB-TOKEN",
  "INPUT_PULL-REQUEST-TOKEN",
]);

export function cliEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => !FORBIDDEN_CLI_VARIABLES.has(name)),
  );
}
