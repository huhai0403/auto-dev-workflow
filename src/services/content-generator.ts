import { generateWithOptionalLlm } from "./llm-provider.js";

const BMAD_SYSTEM_PROMPT = `You are a BMAD-METHOD planning assistant.
Output valid Markdown following BMAD conventions.
Use clear sections, traceability IDs, and actionable acceptance criteria.
Respond in the same language as the user's requirement.`;

export async function enhancePlanningContent(
  useLlm: boolean,
  stepName: string,
  requirement: string,
  templateContent: string,
  extraContext?: string,
): Promise<{ content: string; source: "llm" | "template" }> {
  return generateWithOptionalLlm(useLlm, {
    systemPrompt: BMAD_SYSTEM_PROMPT,
    userPrompt: [
      `Step: ${stepName}`,
      `Requirement: ${requirement}`,
      extraContext ? `Context:\n${extraContext}` : "",
      "",
      "Produce a complete BMAD-format document. Use the template below as structure guide but expand with specific, relevant content:",
      templateContent,
    ]
      .filter(Boolean)
      .join("\n"),
    fallback: templateContent,
  });
}
