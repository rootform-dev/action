import { expect, test } from "bun:test";
import { cliEnvironment } from "./environment.ts";

test("removes GitHub credentials from CLI child environment", () => {
  expect(
    cliEnvironment({
      GITHUB_SHA: "a".repeat(40),
      GITHUB_TOKEN: "ambient-token",
      "INPUT_GITHUB-TOKEN": "release-token",
      "INPUT_PULL-REQUEST-TOKEN": "comment-token",
      ROOTFORM_HOME: "/tmp/rootform",
    }),
  ).toEqual({
    GITHUB_SHA: "a".repeat(40),
    ROOTFORM_HOME: "/tmp/rootform",
  });
});
