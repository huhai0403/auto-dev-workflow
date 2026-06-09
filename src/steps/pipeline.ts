import { promises as fs } from "node:fs";
import path from "node:path";
import { PIPELINE_STEP_LABELS } from "../constants.js";
import { runAiCodeReview, type CodeReviewResult } from "../services/code-reviewer.js";
import { auditBatchEvidence, type EvidenceCheckName } from "../services/evidence-verifier.js";
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
import { globStoryFile } from "../services/batch-resolver.js";
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

async function findStoryFilePath(ctx: StepContext, batch: ReturnType<typeof requireBatch>): Promise<string | undefined> {
  const story = getPrimaryStory(batch);
  if (!story) return undefined;
  const pattern = story.filePattern ?? `${story.key}-*`;
  return (await globStoryFile(batch.implementationArtifactsPath, pattern)) ?? undefined;
}

function buildSentinel(kind: "test" | "lint" | "review", stepId: string, workflowId: string): string {
  return `<!-- bmad-evidence:${kind} step=${stepId} at=${new Date().toISOString()} workflow=${workflowId} -->`;
}

function buildEvidenceSection(opts: {
  header: string;
  sentinel: string;
  body: string;
  extra?: string;
}): string {
  return `\n\n## ${opts.header}\n\n${opts.sentinel}\n\n${opts.body}${opts.extra ? `\n\n${opts.extra}` : ""}\n`;
}

async function appendToStoryFile(
  storyFilePath: string,
  section: string,
): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(storyFilePath, "utf-8");
  } catch {
    existing = "";
  }
  await fs.mkdir(path.dirname(storyFilePath), { recursive: true });
  await fs.writeFile(storyFilePath, existing + section, "utf-8");
}

async function writeEvidenceToStoryFile(opts: {
  ctx: StepContext;
  stepId: string;
  checkName: EvidenceCheckName;
  sectionHeader: string;
  body: string;
  extra?: string;
  stepArtifactPath: string;
}): Promise<void> {
  const batch = requireBatch(opts.ctx);
  const storyPath = await findStoryFilePath(opts.ctx, batch);
  if (!storyPath) return;

  const sentinel = buildSentinel(
    opts.checkName === "test_output"
      ? "test"
      : opts.checkName === "lint_output"
        ? "lint"
        : "review",
    opts.stepId,
    opts.ctx.state.workflowId,
  );
  const section = buildEvidenceSection({
    header: opts.sectionHeader,
    sentinel,
    body: opts.body,
    extra: opts.extra,
  });
  await appendToStoryFile(storyPath, section);
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
      const testOutput = ctx.dryRun ? "DRY-RUN: testing step skipped" : await tryRunUnitTests(ctx.state.projectRoot);
      const content = buildTestingReport(story, testOutput);
      const writeResult = await writePipelineStep(ctx, "testing", content);

      const body = `\`\`\`\n${testOutput ?? "(no test output captured)"}\n\`\`\`\n\n_Test output captured by MCP step \`testing\` at ${new Date().toISOString()}. Source: \`tryRunUnitTests_._`;
      await writeEvidenceToStoryFile({
        ctx,
        stepId: "testing",
        checkName: "test_output",
        sectionHeader: "Test Output",
        body,
        stepArtifactPath: path.join(
          batch.pipelineOutputPath,
          "04-testing.md",
        ),
      });
      return writeResult;
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

      const lintOutput = ctx.dryRun ? "DRY-RUN: lint skipped" : await tryRunLint(ctx.state.projectRoot);
      const review: CodeReviewResult = await runAiCodeReview({
        projectRoot: ctx.state.projectRoot,
        storyKey: story?.key,
        storyTitle: story?.title,
        lintOutput,
      });

      const content = buildPipelineCodeReviewReport(story, review);
      const writeResult = await writePipelineStep(ctx, "code_review_pipeline", content);

      const lintBody = `\`\`\`\n${lintOutput ?? "(no lint output captured)"}\n\`\`\`\n\n_Lint output captured by MCP step \`code_review_pipeline\` at ${new Date().toISOString()}._`;
      await writeEvidenceToStoryFile({
        ctx,
        stepId: "code_review_pipeline",
        checkName: "lint_output",
        sectionHeader: "Lint Output",
        body: lintBody,
        stepArtifactPath: path.join(batch.pipelineOutputPath, "05-code-review.md"),
      });

      const fingerprintBlock = [
        `bmad-fingerprint: source=${review.fingerprint.source}`,
        `bmad-fingerprint: review_hash=${review.fingerprint.reviewHash}`,
        review.fingerprint.model
          ? `bmad-fingerprint: model=${review.fingerprint.model}`
          : null,
        `bmad-fingerprint: reviewed_at=${review.fingerprint.reviewedAt}`,
        `bmad-fingerprint: lint_executed=${review.fingerprint.lintExecuted}`,
        `bmad-fingerprint: file_count=${review.reviewedFiles.length}`,
      ]
        .filter(Boolean)
        .join("\n");
      const reviewBody = `\`\`\`\n${fingerprintBlock}\n\`\`\`\n\n**Verdict: ${review.verdict.toUpperCase()}**\n\n${review.summary}\n\n_Full review: see \`05-code-review.md\` in the run directory._`;
      await writeEvidenceToStoryFile({
        ctx,
        stepId: "code_review_pipeline",
        checkName: "code_review_summary",
        sectionHeader: "Code Review Summary",
        body: reviewBody,
        stepArtifactPath: path.join(batch.pipelineOutputPath, "05-code-review.md"),
      });

      if (review.verdict === "blocked") {
        return {
          ...writeResult,
          success: false,
          error: `Code review verdict is BLOCKED. Re-open story for design discussion.`,
          outputSummary: "AI code review returned BLOCKED — story cannot be marked done.",
        };
      }
      return writeResult;
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

      let audit = null;
      if (batch.selectedStories.length > 0) {
        const pipelineOutput = batch.pipelineOutputPath;
        const stepArtifactPathsForAudit: Partial<Record<EvidenceCheckName, string>> = {
          test_output: path.join(pipelineOutput, "04-testing.md"),
          lint_output: path.join(pipelineOutput, "05-code-review.md"),
          code_review_summary: path.join(pipelineOutput, "05-code-review.md"),
        };
        audit = await auditBatchEvidenceWithCrossRef({
          implementationArtifactsPath: batch.implementationArtifactsPath,
          stories: batch.selectedStories.map((s) => ({
            key: s.key,
            filePattern: s.filePattern,
            title: s.title,
          })),
          stepArtifactPaths: stepArtifactPathsForAudit,
          workflowId: ctx.state.workflowId,
          onRequeue: (key) => {
            const story = batch.selectedStories.find((s) => s.key === key);
            if (story) {
              story.status = "in-progress";
            }
          },
        });
      }

      const content = buildCompletionAuditReport(
        batch,
        batch.selectedStories,
        {
          completedSteps: ctx.state.completedSteps.map(
            (id) => PIPELINE_STEP_LABELS[id as keyof typeof PIPELINE_STEP_LABELS] ?? id,
          ),
          totalTokens,
          totalDurationMs,
        },
        audit,
      );

      const writeResult = await writePipelineStep(ctx, "completion_audit", content);

      if (audit && !audit.allPassed) {
        const errorMessage = `Completion audit failed for stories: ${audit.failedStoryKeys.join(", ")}. Missing evidence: re-queue required.`;
        return {
          ...writeResult,
          success: false,
          error: errorMessage,
          outputSummary: errorMessage,
        };
      }

      return writeResult;
    },
  },
];

async function auditBatchEvidenceWithCrossRef(
  options: Parameters<typeof auditBatchEvidence>[0] & {
    stepArtifactPaths?: Partial<Record<EvidenceCheckName, string>>;
    workflowId?: string;
  },
): ReturnType<typeof auditBatchEvidence> {
  const reports = [];
  for (const s of options.stories) {
    const { verifyStoryEvidence } = await import("../services/evidence-verifier.js");
    const report = await verifyStoryEvidence({
      storyKey: s.key,
      filePattern: s.filePattern,
      implementationArtifactsPath: options.implementationArtifactsPath,
      stepArtifactPaths: options.stepArtifactPaths,
      workflowId: options.workflowId,
    });
    if (!report.passed) {
      report.requeued = true;
      options.onRequeue?.(s.key);
    }
    reports.push(report);
  }
  return {
    reports,
    allPassed: reports.every((r) => r.passed),
    failedStoryKeys: reports.filter((r) => !r.passed).map((r) => r.storyKey),
    requeuedStoryKeys: reports.filter((r) => r.requeued).map((r) => r.storyKey),
  };
}
