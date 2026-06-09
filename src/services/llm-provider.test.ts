import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmProvider } from "./llm-provider.js";

describe("LlmProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("isAvailable", () => {
    it("returns false when no API key is set", () => {
      const provider = new LlmProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it("returns true when OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      const provider = new LlmProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it("returns true when LLM_API_KEY is set", () => {
      process.env.LLM_API_KEY = "test-key";
      const provider = new LlmProvider();
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe("generate", () => {
    it("returns fallback when no API key", async () => {
      const provider = new LlmProvider();
      const result = await provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback-content",
      });
      expect(result).toBe("fallback-content");
    });

    it("returns fallback when API returns non-OK", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("rate limit", { status: 429 }),
      );
      const provider = new LlmProvider();
      const result = await provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback-content",
      });
      expect(result).toBe("fallback-content");
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("returns fallback when API returns empty content", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      );
      const provider = new LlmProvider();
      const result = await provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback-content",
      });
      expect(result).toBe("fallback-content");
    });

    it("returns generated content on success", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "  hello world  " } }] }),
          { status: 200 },
        ),
      );
      const provider = new LlmProvider();
      const result = await provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback",
      });
      expect(result).toBe("hello world");
    });

    it("returns fallback when fetch throws", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
      const provider = new LlmProvider();
      const result = await provider.generate({
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback-content",
      });
      expect(result).toBe("fallback-content");
    });
  });

  describe("generateWithOptionalLlm", () => {
    it("returns template source when useLlm=false", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      const { generateWithOptionalLlm } = await import("./llm-provider.js");
      const result = await generateWithOptionalLlm(false, {
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback",
      });
      expect(result.source).toBe("template");
      expect(result.content).toBe("fallback");
    });

    it("returns template source when no API key", async () => {
      const { generateWithOptionalLlm } = await import("./llm-provider.js");
      const result = await generateWithOptionalLlm(true, {
        systemPrompt: "s",
        userPrompt: "u",
        fallback: "fallback",
      });
      expect(result.source).toBe("template");
    });
  });
});
