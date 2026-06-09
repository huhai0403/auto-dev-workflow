import fs from "node:fs/promises";
import path from "node:path";
import { PLANNING_ARTIFACTS_DIR } from "../constants.js";
import { listBatches } from "./batch-resolver.js";
import type { WorkflowRunResult, WorkflowState } from "../types.js";
import { formatDuration, joinPath } from "../utils.js";

export interface InferredBatch {
  name: string;
  reason: "single" | "newest" | "explicit";
}

export async function inferBatchFromPlanningArtifacts(
  state: WorkflowState,
): Promise<InferredBatch | null> {
  const outputRel = state.outputDir.startsWith(state.projectRoot)
    ? path.relative(state.projectRoot, state.outputDir)
    : ".bmad-output";
  const outputDir = outputRel;

  let batches: Array<{ name: string; mtime: number }> = [];
  try {
    const infos = await listBatches(state.projectRoot, outputDir);
    if (infos.length === 0) return null;
    const planningRoot = joinPath(state.outputDir, PLANNING_ARTIFACTS_DIR);
    batches = await Promise.all(
      infos.map(async (info) => {
        let mtime = 0;
        try {
          const dirStat = await fs.stat(info.planningPath);
          mtime = dirStat.mtimeMs;
        } catch {
          mtime = 0;
        }
        return { name: info.name, mtime };
      }),
    );
  } catch {
    return null;
  }

  if (batches.length === 0) {
    const planningRoot = joinPath(state.outputDir, PLANNING_ARTIFACTS_DIR);
    try {
      const entries = await fs.readdir(planningRoot, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, mtime: 0 }));
      if (dirs.length === 0) return null;
      if (dirs.length === 1) return { name: dirs[0].name, reason: "single" };
      const stats = await Promise.all(
        dirs.map(async (d) => {
          let mtime = 0;
          try {
            mtime = (await fs.stat(joinPath(planningRoot, d.name))).mtimeMs;
          } catch {
            mtime = 0;
          }
          return { ...d, mtime };
        }),
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      return { name: stats[0].name, reason: "newest" };
    } catch {
      return null;
    }
  }

  if (batches.length === 1) {
    return { name: batches[0].name, reason: "single" };
  }

  batches.sort((a, b) => b.mtime - a.mtime);
  return { name: batches[0].name, reason: "newest" };
}

export interface ChainSummary {
  workflowId: string;
  planning: { status: string; completed: number; skipped: number; durationMs: number } | null;
  pipeline: { status: string; completed: number; skipped: number; durationMs: number; batch: string | null } | null;
  planningArtifactDir: string;
  pipelineArtifactDir: string | null;
  totalDurationMs: number;
  generatedAt: string;
}

export function buildChainSummary(
  planningResult: WorkflowRunResult,
  pipelineResult: WorkflowRunResult | null,
  inferredBatchName: string | null,
): ChainSummary {
  const plan = planningResult.state.chainPhases?.[0] ?? planningResult.state;
  const planningDuration = plan.auditLog.reduce((s, e) => s + e.durationMs, 0);

  let pipelineSection: ChainSummary["pipeline"] = null;
  let pipelineDir: string | null = null;
  if (pipelineResult) {
    const phase = pipelineResult.state.chainPhases?.[1] ?? pipelineResult.state;
    const dur = phase.auditLog.reduce((s, e) => s + e.durationMs, 0);
    pipelineSection = {
      status: phase.status,
      completed: phase.completedSteps.length,
      skipped: phase.skippedSteps.length,
      durationMs: dur,
      batch: phase.batch ?? inferredBatchName,
    };
    pipelineDir =
      phase.batchContext?.pipelineOutputPath ??
      (phase.outputDir !== planningResult.state.outputDir ? phase.outputDir : null);
  }

  return {
    workflowId: planningResult.state.workflowId,
    planning: {
      status: plan.status,
      completed: plan.completedSteps.length,
      skipped: plan.skippedSteps.length,
      durationMs: planningDuration,
    },
    pipeline: pipelineSection,
    planningArtifactDir: planningResult.state.outputDir,
    pipelineArtifactDir: pipelineDir,
    totalDurationMs: planningDuration + (pipelineSection?.durationMs ?? 0),
    generatedAt: new Date().toISOString(),
  };
}

export function renderChainSummaryMarkdown(summary: ChainSummary): string {
  const lines: string[] = [
    `# Chain Workflow Summary`,
    ``,
    `Workflow ID: \`${summary.workflowId}\``,
    `Generated at: ${summary.generatedAt}`,
    `Total duration: ${formatDuration(summary.totalDurationMs)}`,
    ``,
    `## Planning phase`,
    ``,
    summary.planning
      ? `- Status: **${summary.planning.status}**\n- Steps completed: ${summary.planning.completed}\n- Steps skipped: ${summary.planning.skipped}\n- Duration: ${formatDuration(summary.planning.durationMs)}\n- Artifacts: \`${summary.planningArtifactDir}\``
      : `- (not run)`,
    ``,
    `## Pipeline phase`,
    ``,
    summary.pipeline
      ? `- Status: **${summary.pipeline.status}**\n- Batch: \`${summary.pipeline.batch ?? "(n/a)"}\`\n- Steps completed: ${summary.pipeline.completed}\n- Steps skipped: ${summary.pipeline.skipped}\n- Duration: ${formatDuration(summary.pipeline.durationMs)}\n- Artifacts: \`${summary.pipelineArtifactDir ?? "(n/a)"}\``
      : `- (not started)`,
    ``,
  ];
  return lines.join("\n");
}
