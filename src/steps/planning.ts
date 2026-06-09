import { PLANNING_STEP_LABELS, PLANNING_OUTPUT_FILES } from "../constants.js";
import { runAiCodeReview, renderReviewMarkdown } from "../services/code-reviewer.js";
import { enhancePlanningContent } from "../services/content-generator.js";
import {
  buildAcceptanceCriteria,
  buildArchitecture,
  buildCodeSkeleton,
  buildFinalReport,
  buildPrd,
  buildTasks,
  buildUserStories,
} from "../templates/bmad-templates.js";
import type { StepContext, StepDefinition, StepResult } from "../types.js";
import { slugify } from "../utils.js";
import { readArtifactIfExists } from "../engine/state-store.js";
import { tryRunLint, writeStepFile } from "./shared.js";

async function writePlanningStep(
  ctx: StepContext,
  stepKey: keyof typeof PLANNING_OUTPUT_FILES,
  content: string,
): Promise<StepResult> {
  ctx.state.artifacts[stepKey] = content;
  return writeStepFile(ctx, stepKey, content);
}

export const planningSteps: StepDefinition[] = [
  {
    id: "discovery",
    label: PLANNING_STEP_LABELS.discovery,
    async execute(ctx) {
      const slug = slugify(ctx.state.requirementDescription);
      const template = buildPrd(ctx.state.requirementDescription, slug);
      const { content } = await enhancePlanningContent(
        "PRD / 需求发现",
        ctx.state.requirementDescription,
        template,
      );
      return writePlanningStep(ctx, "discovery", content);
    },
  },
  {
    id: "user_stories",
    label: PLANNING_STEP_LABELS.user_stories,
    async execute(ctx) {
      const prd =
        ctx.state.artifacts.discovery ??
        (await readArtifactIfExists(ctx.state, PLANNING_OUTPUT_FILES.discovery)) ??
        ctx.state.requirementDescription;
      const template = buildUserStories(ctx.state.requirementDescription, prd);
      const { content } = await enhancePlanningContent(
        "用户故事生成",
        ctx.state.requirementDescription,
        template,
        prd.slice(0, 1500),
      );
      return writePlanningStep(ctx, "user_stories", content);
    },
  },
  {
    id: "acceptance_criteria",
    label: PLANNING_STEP_LABELS.acceptance_criteria,
    async execute(ctx) {
      const template = buildAcceptanceCriteria();
      const { content } = await enhancePlanningContent(
        "验收标准定义",
        ctx.state.requirementDescription,
        template,
        ctx.state.artifacts.user_stories,
      );
      return writePlanningStep(ctx, "acceptance_criteria", content);
    },
  },
  {
    id: "architecture",
    label: PLANNING_STEP_LABELS.architecture,
    async execute(ctx) {
      const template = buildArchitecture(ctx.state.requirementDescription);
      const { content } = await enhancePlanningContent(
        "架构设计建议",
        ctx.state.requirementDescription,
        template,
      );
      return writePlanningStep(ctx, "architecture", content);
    },
  },
  {
    id: "task_breakdown",
    label: PLANNING_STEP_LABELS.task_breakdown,
    async execute(ctx) {
      const template = buildTasks();
      const { content } = await enhancePlanningContent(
        "任务拆解",
        ctx.state.requirementDescription,
        template,
        ctx.state.artifacts.user_stories,
      );
      return writePlanningStep(ctx, "task_breakdown", content);
    },
  },
  {
    id: "code_generation",
    label: PLANNING_STEP_LABELS.code_generation,
    optional: true,
    async execute(ctx) {
      if (!ctx.state.includeCodegen) {
        return { success: true, outputFiles: [], outputSummary: "Skipped (includeCodegen=false)" };
      }
      const slug = slugify(ctx.state.requirementDescription);
      const content = buildCodeSkeleton(slug);
      return writePlanningStep(ctx, "code_generation", content);
    },
  },
  {
    id: "code_review",
    label: PLANNING_STEP_LABELS.code_review,
    optional: true,
    async execute(ctx) {
      if (!ctx.state.includeCodeReview) {
        return { success: true, outputFiles: [], outputSummary: "Skipped (includeCodeReview=false)" };
      }
      const lintOutput = ctx.dryRun ? undefined : await tryRunLint(ctx.state.projectRoot);
      const review = await runAiCodeReview({
        projectRoot: ctx.state.projectRoot,
        lintOutput,
      });
      const content = renderReviewMarkdown(review);
      return writePlanningStep(ctx, "code_review", content);
    },
  },
  {
    id: "audit_report",
    label: PLANNING_STEP_LABELS.audit_report,
    async execute(ctx) {
      const totalDurationMs = ctx.state.auditLog.reduce((sum, e) => sum + e.durationMs, 0);
      const totalTokens = ctx.state.auditLog.reduce((sum, e) => sum + e.tokenEstimate, 0);
      const content = buildFinalReport({
        workflowId: ctx.state.workflowId,
        workflowType: "planning",
        requirementDescription: ctx.state.requirementDescription,
        completedSteps: ctx.state.completedSteps.map(
          (id) => PLANNING_STEP_LABELS[id as keyof typeof PLANNING_STEP_LABELS] ?? id,
        ),
        skippedSteps: ctx.state.skippedSteps.map(
          (id) => PLANNING_STEP_LABELS[id as keyof typeof PLANNING_STEP_LABELS] ?? id,
        ),
        totalDurationMs,
        totalTokens,
        outputDir: ctx.state.outputDir,
        mode: ctx.state.mode,
        lastError: ctx.state.lastError,
      });
      return writePlanningStep(ctx, "audit_report", content);
    },
  },
];
