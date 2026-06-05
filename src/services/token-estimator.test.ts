import { describe, expect, it } from "vitest";
import { estimateTokens } from "./token-estimator.js";

describe("token-estimator", () => {
  it("returns 0 for empty text", async () => {
    expect(await estimateTokens("")).toBe(0);
  });

  it("returns a positive integer estimate for non-empty text", async () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const estimate = await estimateTokens(text);
    expect(estimate).toBeGreaterThan(0);
    expect(Number.isInteger(estimate)).toBe(true);
  });

  it("scales with text length", async () => {
    const short = await estimateTokens("hello world");
    const long = await estimateTokens("hello world ".repeat(50));
    expect(long).toBeGreaterThan(short * 10);
  });
});
