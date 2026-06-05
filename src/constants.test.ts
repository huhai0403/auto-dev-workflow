import { describe, expect, it } from "vitest";
import {
  PLANNING_STEPS,
  PIPELINE_STEPS,
  getOutputFile,
  getStepLabel,
} from "./constants.js";

describe("constants", () => {
  describe("getStepLabel", () => {
    it("returns Chinese label for planning steps", () => {
      expect(getStepLabel("planning", "discovery")).toBe("需求发现");
      expect(getStepLabel("planning", "code_review")).toBe("代码审查");
    });

    it("returns English label for pipeline steps", () => {
      expect(getStepLabel("pipeline", "story_discovery")).toBe("Story Discovery");
      expect(getStepLabel("pipeline", "completion_audit")).toBe("Completion Audit");
    });

    it("returns the id when no label is defined", () => {
      expect(getStepLabel("planning", "unknown_step")).toBe("unknown_step");
    });
  });

  describe("getOutputFile", () => {
    it("returns the canonical output file for a planning step", () => {
      expect(getOutputFile("planning", "discovery")).toBe("01-prd.md");
      expect(getOutputFile("planning", "user_stories")).toBe("02-user-stories.md");
      expect(getOutputFile("planning", "audit_report")).toBe("final-report.md");
    });

    it("returns the canonical output file for a pipeline step", () => {
      expect(getOutputFile("pipeline", "story_discovery")).toBe("01-story-discovery.md");
      expect(getOutputFile("pipeline", "completion_audit")).toBe("08-completion-audit.md");
    });

    it("returns undefined for unknown step", () => {
      expect(getOutputFile("planning", "nope")).toBeUndefined();
    });
  });

  it("PLANNING_STEPS has 8 entries", () => {
    expect(PLANNING_STEPS).toHaveLength(8);
    expect(PLANNING_STEPS[0]).toBe("discovery");
    expect(PLANNING_STEPS[7]).toBe("audit_report");
  });

  it("PIPELINE_STEPS has 8 entries", () => {
    expect(PIPELINE_STEPS).toHaveLength(8);
    expect(PIPELINE_STEPS[0]).toBe("story_discovery");
    expect(PIPELINE_STEPS[7]).toBe("completion_audit");
  });
});
