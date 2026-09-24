import { describe, expect, it } from "vitest";
import { canonicalJson, keyOrderFingerprint, fnv1a } from "../src/core/json-utils.js";

describe("canonicalJson", () => {
  it("produces identical output regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts keys recursively, including inside arrays", () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }] })).toBe('{"z":[{"a":2,"b":1}]}');
  });
});

describe("keyOrderFingerprint", () => {
  it("differs when insertion order differs, even for equal objects", () => {
    const fpA = keyOrderFingerprint({ a: 1, b: 2 }).join(",");
    const fpB = keyOrderFingerprint({ b: 2, a: 1 }).join(",");
    expect(fpA).not.toBe(fpB);
  });

  it("is identical for identically-ordered objects", () => {
    expect(keyOrderFingerprint({ a: 1, b: { c: 2 } })).toEqual(keyOrderFingerprint({ a: 1, b: { c: 2 } }));
  });
});

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
  });

  it("differs for different input", () => {
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
  });
});
