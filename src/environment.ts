const FORBIDDEN_CLI_VARIABLES = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
]);

export function cliEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name]) =>
        !name.toUpperCase().startsWith("INPUT_") &&
        !FORBIDDEN_CLI_VARIABLES.has(name.toUpperCase()),
    ),
  );
}
