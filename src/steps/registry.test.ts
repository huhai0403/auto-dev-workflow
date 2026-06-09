import { describe, expect, it } from "vitest";
import {
  countApplicableSteps,
  getNextStep,
  getStepById,
  getStepsForType,
  pipelineSteps,
  planningSteps,
} from "./registry.js";
import type { WorkflowState } from "../types.js";

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    workflowId: "test-id",
    workflowType: "planning",
    projectRoot: ".",
    outputDir: ".",
    requirementDescription: "test",
    mode: "normal",
    status: "running",
    currentStep: null,
    completedSteps: [],
    skippedSteps: [],
    includeCodegen: true,
    includeCodeReview: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelRequested: false,
    auditLog: [],
    artifacts: {},
    ...overrides,
  };
}

describe("steps/registry", () => {
  describe("getStepsForType", () => {
    it("returns planning steps for planning", () => {
      expect(getStepsForType("planning")).toBe(planningSteps);
    });

    it("returns pipeline steps for pipeline", () => {
      expect(getStepsForType("pipeline")).toBe(pipelineSteps);
    });
  });

  describe("getStepById", () => {
    it("finds a known planning step", () => {
      expect(getStepById("planning", "discovery").id).toBe("discovery");
    });

    it("finds a known pipeline step", () => {
      expect(getStepById("pipeline", "story_discovery").id).toBe("story_discovery");
    });

    it("throws for unknown step", () => {
      expect(() => getStepById("planning", "nope" as never)).toThrow(/Unknown step/);
    });
  });

  describe("getNextStep", () => {
    it("returns the first step when current is null", () => {
      const next = getNextStep("planning", null, makeState());
      expect(next?.id).toBe("discovery");
    });

    it("returns the step after the current one", () => {
      const next = getNextStep("planning", "discovery", makeState());
      expect(next?.id).toBe("user_stories");
    });

    it("skips code_generation when includeCodegen=false", () => {
      const state = makeState({ includeCodegen: false });
      const next = getNextStep("planning", "task_breakdown", state);
      expect(next?.id).toBe("code_review");
    });

    it("skips code_review when includeCodeReview=false (code_generation still runs)", () => {
      const state = makeState({ includeCodeReview: false });
      const next = getNextStep("planning", "task_breakdown", state);
      expect(next?.id).toBe("code_generation");
    });

    it("skips both optional steps when both disabled", () => {
      const state = makeState({ includeCodegen: false, includeCodeReview: false });
      const next = getNextStep("planning", "task_breakdown", state);
      expect(next?.id).toBe("audit_report");
    });

    it("returns null when at the end", () => {
      const next = getNextStep("planning", "audit_report", makeState());
      expect(next).toBeNull();
    });
  });

  describe("countApplicableSteps", () => {
    it("counts all 8 planning steps by default", () => {
      const count = countApplicableSteps(makeState({ workflowType: "planning" }));
      expect(count).toBe(8);
    });

    it("excludes code_generation when disabled", () => {
      const count = countApplicableSteps(
        makeState({ workflowType: "planning", includeCodegen: false }),
      );
      expect(count).toBe(7);
    });

    it("excludes code_review when disabled", () => {
      const count = countApplicableSteps(
        makeState({ workflowType: "planning", includeCodeReview: false }),
      );
      expect(count).toBe(7);
    });

    it("excludes both when both disabled", () => {
      const count = countApplicableSteps(
        makeState({
          workflowType: "planning",
          includeCodegen: false,
          includeCodeReview: false,
        }),
      );
      expect(count).toBe(6);
    });
  });
});
