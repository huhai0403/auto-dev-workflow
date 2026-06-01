import { PIPELINE_STEP_LABELS } from "../constants.js";
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
} from "../templates/pipeline-templates.js";
import type { StepContext, StepDefinition } from "../types.js";
import { tryRunLint, tryRunUnitTests, writeStepFile } from "./shared.js";

function requireBatch(ctx: StepContext) {
  if (!ctx.state.batchContext) {
    throw new Error("Batch context missing — pipeline workflow requires batch resolution at start.");
  }
  return ctx.state.batchContext;
}

async function writePipelineStep(ctx: StepContext, stepId: StepDefinition["id"], content: string) {
  const batch = requireBatch(ctx);
  ctx.state.artifacts[stepId] = content;
  return writeStepFile(ctx, stepId, content, batch.pipelineOutputPath);
}

export const pipelineSteps: StepDefinition[] = [
  {
    id: "story_discovery",
    label: PIPELINE_STEP_LABELS.story_discovery,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const content = buildStoryDiscoveryReport(batch);
      return writePipelineStep(ctx, "story_discovery", content);
    },
  },
  {
    id: "create_story",
    label: PIPELINE_STEP_LABELS.create_story,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const content = buildCreateStoryReport(batch, story);
      return writePipelineStep(ctx, "create_story", content);
    },
  },
  {
    id: "development",
    label: PIPELINE_STEP_LABELS.development,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const content = buildDevelopmentReport(story);
      return writePipelineStep(ctx, "development", content);
    },
  },
  {
    id: "testing",
    label: PIPELINE_STEP_LABELS.testing,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const testOutput = ctx.dryRun ? undefined : await tryRunUnitTests(ctx.state.projectRoot);
      const content = buildTestingReport(story, testOutput);
      return writePipelineStep(ctx, "testing", content);
    },
  },
  {
    id: "code_review_pipeline",
    label: PIPELINE_STEP_LABELS.code_review_pipeline,
    optional: true,
    async execute(ctx) {
      if (!ctx.state.includeCodeReview) {
        return { success: true, outputFiles: [], outputSummary: "Skipped (includeCodeReview=false)" };
      }
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const lintOutput = ctx.dryRun ? undefined : await tryRunLint(ctx.state.projectRoot);
      const content = buildPipelineCodeReviewReport(story, lintOutput);
      return writePipelineStep(ctx, "code_review_pipeline", content);
    },
  },
  {
    id: "status_update",
    label: PIPELINE_STEP_LABELS.status_update,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const content = buildStatusUpdateReport(batch, story);
      return writePipelineStep(ctx, "status_update", content);
    },
  },
  {
    id: "checkpoint",
    label: PIPELINE_STEP_LABELS.checkpoint,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const story = getPrimaryStory(batch);
      const content = buildCheckpointReport(story);
      return writePipelineStep(ctx, "checkpoint", content);
    },
  },
  {
    id: "completion_audit",
    label: PIPELINE_STEP_LABELS.completion_audit,
    async execute(ctx) {
      const batch = requireBatch(ctx);
      const totalDurationMs = ctx.state.auditLog.reduce((sum, e) => sum + e.durationMs, 0);
      const totalTokens = ctx.state.auditLog.reduce((sum, e) => sum + e.tokenEstimate, 0);
      const content = buildCompletionAuditReport(batch, batch.selectedStories, {
        completedSteps: ctx.state.completedSteps.map(
          (id) => PIPELINE_STEP_LABELS[id as keyof typeof PIPELINE_STEP_LABELS] ?? id,
        ),
        totalTokens,
        totalDurationMs,
      });
      return writePipelineStep(ctx, "completion_audit", content);
    },
  },
];
