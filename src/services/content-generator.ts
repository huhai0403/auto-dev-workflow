export interface EnhancedPlanningContent {
  content: string;
  source: "template";
}

export async function enhancePlanningContent(
  _stepName: string,
  _requirement: string,
  templateContent: string,
  _extraContext?: string,
): Promise<EnhancedPlanningContent> {
  return { content: templateContent, source: "template" };
}
