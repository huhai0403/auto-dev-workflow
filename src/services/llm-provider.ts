export interface LlmGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  fallback: string;
}

export class LlmProvider {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
    this.baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(options: LlmGenerateOptions): Promise<string> {
    if (!this.apiKey) {
      return options.fallback;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LLM API ${response.status}: ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("LLM returned empty content");
      }
      return content;
    } catch {
      return options.fallback;
    }
  }
}

export const llmProvider = new LlmProvider();

export async function generateWithOptionalLlm(
  useLlm: boolean,
  options: LlmGenerateOptions,
): Promise<{ content: string; source: "llm" | "template" }> {
  if (!useLlm || !llmProvider.isAvailable()) {
    return { content: options.fallback, source: "template" };
  }

  const content = await llmProvider.generate(options);
  const usedLlm = content !== options.fallback && content.length > options.fallback.length * 0.5;
  return { content, source: usedLlm ? "llm" : "template" };
}
