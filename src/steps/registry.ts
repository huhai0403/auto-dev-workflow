import type { StepContext, StepDefinition, WorkflowState, WorkflowStepId, WorkflowType } from "../types.js";
import { planningSteps } from "./planning.js";
import { pipelineSteps } from "./pipeline.js";

export function getStepsForType(workflowType: WorkflowType): StepDefinition[] {
  return workflowType === "planning" ? planningSteps : pipelineSteps;
}

export function getStepById(workflowType: WorkflowType, id: WorkflowStepId): StepDefinition {
  const step = getStepsForType(workflowType).find((s) => s.id === id);
  if (!step) throw new Error(`Unknown step: ${id} for workflow type ${workflowType}`);
  return step;
}

export function getNextStep(
  workflowType: WorkflowType,
  current: WorkflowStepId | null,
  state: StepContext["state"],
): StepDefinition | null {
  const steps = getStepsForType(workflowType);
  const startIndex = current ? steps.findIndex((s) => s.id === current) + 1 : 0;

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];
    if (step.optional) {
      if (step.id === "code_generation" && !state.includeCodegen) continue;
      if (step.id === "code_review" && !state.includeCodeReview) continue;
      if (step.id === "code_review_pipeline" && !state.includeCodeReview) continue;
    }
    return step;
  }
  return null;
}

export function countApplicableSteps(state: WorkflowState): number {
  const steps = getStepsForType(state.workflowType);
  return steps.filter((step) => {
    if (step.id === "code_generation" && !state.includeCodegen) return false;
    if (step.id === "code_review" && !state.includeCodeReview) return false;
    if (step.id === "code_review_pipeline" && !state.includeCodeReview) return false;
    return true;
  }).length;
}

export { planningSteps, pipelineSteps };
