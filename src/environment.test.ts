import { expect, test } from "bun:test";
import { cliEnvironment } from "./environment.ts";

test("filters GitHub, Actions, OIDC and INPUT credentials while preserving Rootform home", () => {
  expect(
    cliEnvironment({
      GITHUB_TOKEN: "github-token-sentinel",
      GH_TOKEN: "gh-token-sentinel",
      ACTIONS_RUNTIME_TOKEN: "runtime-token-sentinel",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token-sentinel",
      "INPUT_GITHUB-TOKEN": "release-token-sentinel",
      "INPUT_PULL-REQUEST-TOKEN": "comment-token-sentinel",
      INPUT_CUSTOM: "input-value-sentinel",
      input_case_variant: "case-variant-sentinel",
      GITHUB_WORKSPACE: "/runner/work/project",
      GITHUB_SHA: "a".repeat(40),
      PATH: "/usr/bin",
      ROOTFORM_HOME: "/runner/temp/rootform-home",
      ROOTFORM_SETTING: "preserved-setting",
    }),
  ).toEqual({
    GITHUB_WORKSPACE: "/runner/work/project",
    GITHUB_SHA: "a".repeat(40),
    PATH: "/usr/bin",
    ROOTFORM_HOME: "/runner/temp/rootform-home",
    ROOTFORM_SETTING: "preserved-setting",
  });
});
