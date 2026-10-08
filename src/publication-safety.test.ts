import { expect, test } from "bun:test";
import { assertPublicMessage, assertReportMessage } from "./publication-safety.ts";

test("consumer evidence keeps user paths and legitimate model terminology", () => {
  const value = `AI agent follows a public spec. Local output: /${"Users/fictional/output"}`;
  expect(() => assertReportMessage(value, "example/project")).not.toThrow();
  expect(() => assertReportMessage(value, "rootform-dev/rootform")).toThrow("personal-path");
  expect(() => assertPublicMessage(value)).toThrow("personal-path");
});

test("consumer reports and maintainer messages both refuse synthetic credentials", () => {
  for (const value of [
    "AKIA" + "Z".repeat(16),
    "xoxb" + "-SYNTHETIC".repeat(6),
    "Bearer " + "SYNTHETIC".repeat(8),
  ]) {
    expect(() => assertReportMessage({ message: value })).toThrow("credential");
    expect(() => assertPublicMessage(value)).toThrow("credential");
  }
});

test("encoded credentials are refused before consumer reporting without changing path policy", () => {
  const secret = "Bearer " + "SYNTHETIC".repeat(8);
  for (const value of [
    encodeURIComponent(encodeURIComponent(secret)),
    { encoding: "base64", content: btoa(secret) },
  ]) {
    expect(() => assertReportMessage(value, "example/project")).toThrow("credential");
    expect(() => assertPublicMessage(value)).toThrow("credential");
  }
  const path = "/" + "Users/fictional/output";
  expect(() => assertReportMessage(encodeURIComponent(path), "example/project")).not.toThrow();
  expect(() => assertReportMessage(encodeURIComponent(path), "rootform-dev/action")).toThrow(
    "personal-path",
  );
});
