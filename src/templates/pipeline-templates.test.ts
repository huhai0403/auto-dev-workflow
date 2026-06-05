import { describe, expect, it } from "vitest";
import {
  buildCheckpointReport,
  buildCompletionAuditReport,
  buildCreateStoryReport,
  buildDevelopmentReport,
  buildPipelineCodeReviewReport,
  buildStatusUpdateReport,
  buildStoryDiscoveryReport,
  buildTestingReport,
  getPrimaryStory,
} from "./pipeline-templates.js";
import type { BatchContext, StoryEntry } from "../types.js";
import type { CodeReviewResult } from "../services/code-reviewer.js";

function makeBatch(overrides: Partial<BatchContext> = {}): BatchContext {
  return {
    batchName: "v1.3.13-test",
    planningArtifactsPath: "/proj/.bmad-output/planning-artifacts/v1.3.13-test",
    implementationArtifactsPath: "/proj/.bmad-output/implementation-artifacts/v1.3.13-test",
    sprintStatusPath: "/proj/sprint-status.md",
    sprintStatusFormat: "markdown",
    targetEpic: "1",
    targetStory: undefined,
    selectedStories: [],
    pipelineOutputPath: "/proj/.bmad-output/implementation-artifacts/v1.3.13-test/mcp-workflow-run",
    ...overrides,
  };
}

const story = (overrides: Partial<StoryEntry> = {}): StoryEntry => ({
  key: "1-1-test-story",
  title: "Test Story",
  status: "ready-for-dev",
  epic: "1",
  filePattern: "1-1-*",
  ...overrides,
});

describe("pipeline-templates", () => {
  describe("buildStoryDiscoveryReport", () => {
    it("emits a header with batch and target info", () => {
      const out = buildStoryDiscoveryReport(makeBatch());
      expect(out).toContain("Step 01: Story Discovery");
      expect(out).toContain("v1.3.13-test");
      expect(out).toContain("Sprint Status");
    });

    it("renders the next eligible story", () => {
      const batch = makeBatch({ selectedStories: [story()] });
      const out = buildStoryDiscoveryReport(batch);
      expect(out).toContain("1-1-test-story");
      expect(out).toContain("Next Story to Process");
    });

    it("emits a no-stories marker when list is empty", () => {
      const out = buildStoryDiscoveryReport(makeBatch());
      expect(out).toContain("No stories matched");
    });
  });

  describe("buildCreateStoryReport", () => {
    it("emits story context and a story-file template", () => {
      const out = buildCreateStoryReport(makeBatch(), story());
      expect(out).toContain("Step 02: Create Story");
      expect(out).toContain("1-1-test-story");
      expect(out).toContain("Story File Template");
    });
  });

  describe("buildDevelopmentReport", () => {
    it("emits a development checklist", () => {
      const out = buildDevelopmentReport(story());
      expect(out).toContain("Step 03: Development");
      expect(out).toContain("Load story file");
    });
  });

  describe("buildTestingReport", () => {
    it("marks tests as executed when output is given", () => {
      const out = buildTestingReport(story(), "test-output");
      expect(out).toContain("Step 04: Testing");
      expect(out).toContain("test-output");
      expect(out).toContain("Executed");
    });

    it("marks tests as skipped when no output", () => {
      const out = buildTestingReport(story());
      expect(out).toContain("Skipped");
    });
  });

  describe("buildPipelineCodeReviewReport", () => {
    it("includes lint output when provided", () => {
      const review: CodeReviewResult = {
        verdict: "approve",
        summary: "Looks good",
        findings: [],
        reviewedFiles: ["src/foo.ts"],
        reviewSource: "llm",
        rawOutput: "",
        lintOutput: "lint-here",
        fingerprint: {
          source: "llm",
          model: "gpt-4o-mini",
          reviewHash: "abc123",
          reviewedAt: "2026-06-05T10:00:00Z",
          changedFiles: ["src/foo.ts"],
          lintExecuted: true,
        },
      };
      const out = buildPipelineCodeReviewReport(story(), review);
      expect(out).toContain("Step 05: Code Review");
      expect(out).toContain("lint-here");
    });

    it("shows BLOCKED banner when verdict is blocked", () => {
      const review: CodeReviewResult = {
        verdict: "blocked",
        summary: "Design call needed",
        findings: [],
        reviewedFiles: [],
        reviewSource: "llm",
        rawOutput: "",
        fingerprint: {
          source: "llm",
          model: "gpt-4o-mini",
          reviewHash: "abc",
          reviewedAt: "2026-06-05T10:00:00Z",
          changedFiles: [],
          lintExecuted: false,
        },
      };
      const out = buildPipelineCodeReviewReport(story(), review);
      expect(out).toContain("BLOCKED");
    });
  });

  describe("buildStatusUpdateReport", () => {
    it("proposes status transition", () => {
      const out = buildStatusUpdateReport(makeBatch(), story());
      expect(out).toContain("review");
      expect(out).toContain("1-1-test-story");
    });
  });

  describe("buildCheckpointReport", () => {
    it("indicates auto-continuation in MCP headless mode", () => {
      const out = buildCheckpointReport(story());
      expect(out).toContain("Step 07: Checkpoint");
      expect(out).toMatch(/[Aa]uto-continuing/);
    });
  });

  describe("buildCompletionAuditReport", () => {
    it("emits evidence checklist for each story", () => {
      const out = buildCompletionAuditReport(
        makeBatch({ selectedStories: [story(), story({ key: "1-2-x", title: "B" })] }),
        [story(), story({ key: "1-2-x", title: "B" })],
        { completedSteps: ["step-1"], totalTokens: 10, totalDurationMs: 1000 },
        null,
      );
      expect(out).toContain("Step 08: Completion Audit");
      expect(out).toContain("1-1-test-story");
      expect(out).toContain("1-2-x");
    });

    it("renders audit results when provided", () => {
      const out = buildCompletionAuditReport(
        makeBatch({ selectedStories: [story()] }),
        [story()],
        { completedSteps: ["step-1"], totalTokens: 10, totalDurationMs: 1000 },
        {
          reports: [
            {
              storyKey: "1-1",
              checks: [
                { name: "test_output", required: true, passed: true, details: "ok" },
                { name: "lint_output", required: true, passed: false, details: "missing" },
                { name: "code_review_summary", required: true, passed: true, details: "ok" },
                { name: "dod_checklist", required: true, passed: true, details: "ok" },
              ],
              passed: false,
              missingRequired: ["lint_output"],
              requeued: true,
            },
          ],
          allPassed: false,
          failedStoryKeys: ["1-1"],
          requeuedStoryKeys: ["1-1"],
        },
      );
      expect(out).toContain("4-Checkpoint Evidence Gate Results");
      expect(out).toContain("1 story/stories failed");
      expect(out).toContain("Re-queued Stories");
    });
  });

  describe("getPrimaryStory", () => {
    it("returns null when no stories", () => {
      expect(getPrimaryStory(makeBatch())).toBeNull();
    });

    it("prefers ready-for-dev over backlog", () => {
      const batch = makeBatch({
        selectedStories: [
          story({ key: "1-2", status: "backlog" }),
          story({ key: "1-1", status: "ready-for-dev" }),
        ],
      });
      const primary = getPrimaryStory(batch);
      expect(primary?.key).toBe("1-1");
    });

    it("falls back to first story when no priority match", () => {
      const batch = makeBatch({
        selectedStories: [story({ key: "1-3", status: "weird" })],
      });
      expect(getPrimaryStory(batch)?.key).toBe("1-3");
    });
  });
});
