// WR-04 regression suite: post-login redirect targets must be same-origin
// absolute paths. Protocol-relative URLs, backslash tricks and scheme
// payloads fall back to /dashboard - the guard no longer relies on router
// pushState internals to throw on cross-origin values.

import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "./session-guards";

describe("safeRedirectTarget (WR-04)", () => {
  it.each([
    ["/customers", "/customers"],
    ["/dashboard", "/dashboard"],
    ["/bills?id=9", "/bills?id=9"],
    [undefined, "/dashboard"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    // Protocol-relative navigation escape.
    ["//evil.example/path", "/dashboard"],
    ["///triple", "/dashboard"],
    // Backslash trickery.
    ["/\\evil.example", "/dashboard"],
    ["\\evil", "/dashboard"],
    // Scheme payloads.
    ["https://evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("safeRedirectTarget(%s) -> %s", (input, expected) => {
    expect(safeRedirectTarget(input)).toBe(expected);
  });
});
