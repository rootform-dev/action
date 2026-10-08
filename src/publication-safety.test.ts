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

test("named credentials are checked recursively while exact synthetic literals remain valid", () => {
  const credential = "SYNTHETIC".repeat(8);
  for (const payload of [
    { API_TOKEN: credential },
    { encoding: "base64", content: btoa(JSON.stringify({ api_key: credential })) },
    {
      encoding: "base64",
      content: btoa(
        JSON.stringify({ encoding: "base64", content: btoa("github_" + "pat_" + credential) }),
      ),
    },
  ])
    expect(() => assertPublicMessage(payload)).toThrow("credential");
  for (const value of [
    "ROOTFORM_DATADOG_CLOUDFLARE_KEY_SENTINEL",
    "ROOTFORM_DATADOG_FASTLY_KEY_SENTINEL",
    "ROOTFORM_HCP_DATADOG_API_SENTINEL",
    "ROOTFORM_ATLAS_OBSERVABILITY_SECRET",
  ]) {
    expect(() => assertPublicMessage({ api_key: value })).not.toThrow();
    expect(() => assertPublicMessage({ api_key: value + "_CHANGED" })).toThrow("credential");
  }
  const path = "/" + "Users/fictional/session";
  expect(() =>
    assertPublicMessage({
      encoding: "base64",
      content: btoa(JSON.stringify({ value: path }).replaceAll("/", "\\u002f")),
    }),
  ).toThrow("personal-path");
});

test("nested JSON and rendered metadata cannot hide private text", () => {
  const credential = "SYNTHETIC".repeat(8);
  const path = "/" + "Users/fictional/session";
  for (const value of [
    { body: JSON.stringify({ API_KEY: credential }) },
    '"api_key": "' + credential + '"',
    { body: JSON.stringify({ CLOUDFLARE_API_KEY: credential }) },
    { encoding: "base64", content: Buffer.from(path, "utf16le").toString("base64") },
    ["&#47", ";Users&#47", ";fictional&#47", ";session"].join(""),
    "notes/" + "fictional-session/report.json",
  ])
    expect(() => assertPublicMessage(value)).toThrow("Public message refused:");
  for (const value of [
    "ROOTFORM_DATADOG_CLOUDFLARE_KEY_SENTINEL",
    "ROOTFORM_DATADOG_FASTLY_KEY_SENTINEL",
    "ROOTFORM_HCP_DATADOG_API_SENTINEL",
    "ROOTFORM_ATLAS_OBSERVABILITY_SECRET",
  ])
    expect(() => assertPublicMessage('api_key = "' + value + '"')).not.toThrow();
});
