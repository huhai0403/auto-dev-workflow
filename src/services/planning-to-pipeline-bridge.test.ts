import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildChainSummary,
  inferBatchFromPlanningArtifacts,
  renderChainSummaryMarkdown,
} from "./planning-to-pipeline-bridge.js";
import type { WorkflowRunResult, WorkflowState } from "../types.js";

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    workflowId: "bmad-20260609-abcdef01",
    workflowType: "planning",
    projectRoot: "/tmp/proj",
    outputDir: "/tmp/proj/.bmad-output",
    requirementDescription: "Test",
    mode: "normal",
    status: "completed",
    currentStep: null,
    completedSteps: ["discovery", "user_stories"],
    skippedSteps: [],
    includeCodegen: true,
    includeCodeReview: true,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
    cancelRequested: false,
    auditLog: [],
    artifacts: {},
    ...overrides,
  };
}

describe("inferBatchFromPlanningArtifacts", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-bridge-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns null when no planning-artifacts directory exists", async () => {
    const state = makeState({ projectRoot: tmp, outputDir: path.join(tmp, ".bmad-output") });
    const result = await inferBatchFromPlanningArtifacts(state);
    expect(result).toBeNull();
  });

  it("returns null when planning-artifacts exists but is empty", async () => {
    await mkdir(path.join(tmp, ".bmad-output", "planning-artifacts"), { recursive: true });
    const state = makeState({ projectRoot: tmp, outputDir: path.join(tmp, ".bmad-output") });
    const result = await inferBatchFromPlanningArtifacts(state);
    expect(result).toBeNull();
  });

  it("returns the single batch with reason=single", async () => {
    const pa = path.join(tmp, ".bmad-output", "planning-artifacts", "todo-v1");
    await mkdir(pa, { recursive: true });
    await writeFile(path.join(pa, "prd.md"), "# PRD", "utf-8");
    const state = makeState({ projectRoot: tmp, outputDir: path.join(tmp, ".bmad-output") });
    const result = await inferBatchFromPlanningArtifacts(state);
    expect(result).toEqual({ name: "todo-v1", reason: "single" });
  });

  it("returns the newest batch when multiple exist (reason=newest)", async () => {
    const root = path.join(tmp, ".bmad-output", "planning-artifacts");
    const old1 = path.join(root, "old-batch");
    const new1 = path.join(root, "new-batch");
    await mkdir(old1, { recursive: true });
    await mkdir(new1, { recursive: true });
    await writeFile(path.join(old1, "prd.md"), "# old", "utf-8");
    await writeFile(path.join(new1, "prd.md"), "# new", "utf-8");

    const oldTime = new Date("2026-01-01T00:00:00Z");
    const newTime = new Date("2026-06-01T00:00:00Z");
    await import("node:fs/promises").then((m) =>
      m.utimes(old1, oldTime, oldTime).then(() => m.utimes(new1, newTime, newTime)),
    );

    const state = makeState({ projectRoot: tmp, outputDir: path.join(tmp, ".bmad-output") });
    const result = await inferBatchFromPlanningArtifacts(state);
    expect(result).toEqual({ name: "new-batch", reason: "newest" });
  });

  it("handles path with Chinese and spaces via listBatches filter", async () => {
    const pa = path.join(tmp, ".bmad-output", "planning-artifacts", "中文 批 1");
    await mkdir(pa, { recursive: true });
    await writeFile(path.join(pa, "prd.md"), "# PRD", "utf-8");
    const state = makeState({ projectRoot: tmp, outputDir: path.join(tmp, ".bmad-output") });
    const result = await inferBatchFromPlanningArtifacts(state);
    expect(result?.name).toBe("中文 批 1");
  });
});

describe("buildChainSummary + renderChainSummaryMarkdown", () => {
  it("builds summary for planning only (pipeline not started)", () => {
    const planState = makeState({
      status: "completed",
      completedSteps: ["discovery", "user_stories", "audit_report"],
      auditLog: [
        { step: "discovery", stepLabel: "d", startedAt: "", endedAt: "", durationMs: 100, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "planning" },
        { step: "user_stories", stepLabel: "us", startedAt: "", endedAt: "", durationMs: 200, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "planning" },
        { step: "audit_report", stepLabel: "ar", startedAt: "", endedAt: "", durationMs: 50, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "planning" },
      ],
    });
    const planResult: WorkflowRunResult = { state: planState, message: "ok" };
    const summary = buildChainSummary(planResult, null, null);
    expect(summary.planning?.completed).toBe(3);
    expect(summary.planning?.durationMs).toBe(350);
    expect(summary.pipeline).toBeNull();
    const md = renderChainSummaryMarkdown(summary);
    expect(md).toContain("Chain Workflow Summary");
    expect(md).toContain("Planning phase");
    expect(md).toContain("Pipeline phase");
    expect(md).toContain("not started");
  });

  it("builds summary for planning + pipeline both completed", () => {
    const planPhase: WorkflowState = makeState({
      status: "completed",
      completedSteps: ["discovery", "user_stories"],
      auditLog: [
        { step: "discovery", stepLabel: "d", startedAt: "", endedAt: "", durationMs: 100, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "planning" },
        { step: "user_stories", stepLabel: "us", startedAt: "", endedAt: "", durationMs: 200, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "planning" },
      ],
    });
    const planState = makeState({
      chainPhases: [planPhase],
      currentChainPhase: 0,
    });
    planState.workflowId = "bmad-test-pipeline-chain";
    const planResult: WorkflowRunResult = { state: planState, message: "plan ok" };

    const pipelinePhase = makeState({
      workflowType: "pipeline",
      status: "completed",
      batch: "todo-v1",
      batchContext: {
        batchName: "todo-v1",
        planningArtifactsPath: "/tmp/p",
        implementationArtifactsPath: "/tmp/i",
        selectedStories: [],
        pipelineOutputPath: "/tmp/i/mcp-workflow-run",
      },
      completedSteps: ["story_discovery", "development", "completion_audit"],
      auditLog: [
        { step: "story_discovery", stepLabel: "sd", startedAt: "", endedAt: "", durationMs: 150, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "pipeline" },
        { step: "development", stepLabel: "dev", startedAt: "", endedAt: "", durationMs: 2000, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "pipeline" },
        { step: "completion_audit", stepLabel: "ca", startedAt: "", endedAt: "", durationMs: 80, inputSummary: "", outputSummary: "", outputFiles: [], tokenEstimate: 0, success: true, retryCount: 0, phase: "pipeline" },
      ],
    });
    const pipelineState = makeState({
      workflowType: "pipeline",
      chainPhases: [planPhase, pipelinePhase],
      currentChainPhase: 1,
    });
    const pipelineResult: WorkflowRunResult = { state: pipelineState, message: "pipeline ok" };

    const summary = buildChainSummary(planResult, pipelineResult, "todo-v1");
    expect(summary.planning?.completed).toBe(2);
    expect(summary.planning?.durationMs).toBe(300);
    expect(summary.pipeline?.status).toBe("completed");
    expect(summary.pipeline?.completed).toBe(3);
    expect(summary.pipeline?.durationMs).toBe(2230);
    expect(summary.pipeline?.batch).toBe("todo-v1");
    expect(summary.totalDurationMs).toBe(2530);
    expect(summary.pipelineArtifactDir).toBe("/tmp/i/mcp-workflow-run");

    const md = renderChainSummaryMarkdown(summary);
    expect(md).toContain("todo-v1");
    expect(md).toContain("Status: **completed**");
  });
});
