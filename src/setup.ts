import * as core from "@actions/core";
import { type Installation, installRootform } from "./install.ts";

export type SetupDependencies = {
  core: {
    getInput(name: string): string;
    setOutput(name: string, value: string): void;
    setSecret?(value: string): void;
  };
  install(options: { token: string; version: string }): Promise<Installation>;
};

const defaultDependencies: SetupDependencies = {
  core,
  install: installRootform,
};

export async function setup(dependencies: SetupDependencies = defaultDependencies): Promise<void> {
  const token = dependencies.core.getInput("github-token");
  if (token) dependencies.core.setSecret?.(token);
  const installation = await dependencies.install({
    token,
    version: dependencies.core.getInput("version") || "latest",
  });
  dependencies.core.setOutput("version", installation.version);
  dependencies.core.setOutput("sha256", installation.sha256);
}
