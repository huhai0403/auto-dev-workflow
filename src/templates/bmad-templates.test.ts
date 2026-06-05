import { describe, expect, it } from "vitest";
import {
  BMAD_RULES,
  buildAcceptanceCriteria,
  buildArchitecture,
  buildCodeReviewPlaceholder,
  buildCodeSkeleton,
  buildFinalReport,
  buildPrd,
  buildTasks,
  buildUserStories,
} from "./bmad-templates.js";

describe("bmad-templates", () => {
  describe("BMAD_RULES", () => {
    it("defines the canonical PRD sections", () => {
      expect(BMAD_RULES.prdSections).toContain("Executive Summary");
      expect(BMAD_RULES.prdSections).toContain("Problem Statement");
    });

    it("uses canonical user-story template", () => {
      expect(BMAD_RULES.userStoryFormat).toContain("As a");
      expect(BMAD_RULES.userStoryFormat).toContain("I want");
      expect(BMAD_RULES.userStoryFormat).toContain("so that");
    });

    it("uses canonical AC template (BDD Given/When/Then)", () => {
      expect(BMAD_RULES.acceptanceCriteriaFormat).toMatch(/Given.*When.*Then/);
    });

    it("exposes story priority scale", () => {
      expect(BMAD_RULES.storyPriority).toEqual(["P0", "P1", "P2", "P3"]);
    });
  });

  describe("buildPrd", () => {
    it("returns markdown that includes the requirement and all sections", () => {
      const out = buildPrd("Build a todo app", "todo-app");
      for (const section of BMAD_RULES.prdSections) {
        expect(out).toContain(`## ${section}`);
      }
      expect(out).toContain("Build a todo app");
      expect(out).toContain("todo-app");
    });
  });

  describe("buildUserStories", () => {
    it("uses canonical user-story format", () => {
      const out = buildUserStories("Build X", "PRD excerpt");
      expect(out).toContain("As a");
      expect(out).toContain("I want");
      expect(out).toContain("so that");
      expect(out).toContain("Priority");
    });

    it("includes PRD excerpt in notes", () => {
      const out = buildUserStories("Req", "EXCERPT-MARKER");
      expect(out).toContain("EXCERPT-MARKER");
    });
  });

  describe("buildAcceptanceCriteria", () => {
    it("uses BDD Given/When/Then format", () => {
      const out = buildAcceptanceCriteria();
      expect(out).toContain("**Given**");
      expect(out).toContain("**When**");
      expect(out).toContain("**Then**");
    });
  });

  describe("buildArchitecture", () => {
    it("includes context and three architecture options", () => {
      const out = buildArchitecture("req");
      expect(out).toContain("## Context");
      expect(out).toContain("Option A");
      expect(out).toContain("Option B");
      expect(out).toContain("Option C");
      expect(out).toContain("Recommendation");
    });
  });

  describe("buildTasks", () => {
    it("emits task table with id, task, estimate, depends", () => {
      const out = buildTasks();
      expect(out).toContain("| ID | Task | Estimate | Depends |");
      expect(out).toContain("T-1.1.1");
    });
  });

  describe("buildCodeSkeleton", () => {
    it("includes suggested project structure", () => {
      const out = buildCodeSkeleton("slug");
      expect(out).toContain("src/");
      expect(out).toContain("index.ts");
    });
  });

  describe("buildCodeReviewPlaceholder", () => {
    it("marks lint status correctly when lint output is given", () => {
      const out = buildCodeReviewPlaceholder("lint output here");
      expect(out).toContain("Lint executed");
      expect(out).toContain("lint output here");
    });

    it("marks lint as skipped when no output", () => {
      const out = buildCodeReviewPlaceholder();
      expect(out).toContain("Placeholder");
    });
  });

  describe("buildFinalReport", () => {
    it("contains all summary fields", () => {
      const out = buildFinalReport({
        workflowId: "wf-1",
        workflowType: "planning",
        requirementDescription: "Req",
        completedSteps: ["discovery"],
        skippedSteps: [],
        totalDurationMs: 1500,
        totalTokens: 100,
        outputDir: "./out",
        mode: "normal",
      });
      expect(out).toContain("wf-1");
      expect(out).toContain("planning");
      expect(out).toContain("Req");
      expect(out).toContain("discovery");
    });
  });
});
