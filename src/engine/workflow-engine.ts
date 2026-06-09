import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_STEP_RETRIES,
  getOutputFile,
  getStepLabel,
} from "../constants.js";
import { listBatches, resolveBatch } from "../services/batch-resolver.js";
import {
  buildChainSummary,
  inferBatchFromPlanningArtifacts,
  renderChainSummaryMarkdown,
} from "../services/planning-to-pipeline-bridge.js";
import { estimateTokens } from "../services/token-estimator.js";
import {
  appendChainPhase,
  ensureOutputDir,
  getActiveChainPhase,
  loadState,
  resolveOutputDir,
  saveState,
  syncChainPhaseToTopLevel,
  writeAuditLog,
} from "./state-store.js";
import {
  countApplicableSteps,
  getNextStep,
  getStepById,
  getStepsForType,
} from "../steps/registry.js";
import type {
  DryRunPreviewItem,
  ListBatchesOptions,
  StartWorkflowOptions,
  StepAuditEntry,
  WorkflowRunResult,
  WorkflowState,
  WorkflowStatusSummary,
  WorkflowStepId,
  WorkflowType,
} from "../types.js";
import { createWorkflowId, joinPath, nowIso, truncate } from "../utils.js";

const CHAIN_MAX_SUMMARY_LINES = 200;
const CHAIN_PREVIEW_LINES = 30;

export class WorkflowEngine {
  private runningProjects = new Set<string>();

  async listBatches(options: ListBatchesOptions) {
    return listBatches(options.projectRoot, options.outputDir);
  }

  async start(options: StartWorkflowOptions): Promise<WorkflowRunResult> {
    const projectRoot = joinPath(options.projectRoot);
    if (!options.outputDir?.trim()) {
      throw new Error("output_dir is required (e.g. '.bmad-output' or '_bmad-output').");
    }

    const workflowType = options.workflowType ?? "planning";
    this.validateStartOptions(workflowType, options);

    const existing = await loadState(projectRoot);
    if (existing) {
      const active = getActiveChainPhase(existing);
      if (active.status === "running") {
        throw new Error(
          `Workflow already running for ${projectRoot}. Use resume_bmad_workflow or cancel_workflow first.`,
        );
      }
    }

    const mode = options.mode ?? "normal";
    const outputDir = resolveOutputDir(projectRoot, options.outputDir);
    const chainToPipeline = options.chainToPipeline ?? true;

    let batchContext;
    if (workflowType === "pipeline") {
      batchContext = await resolveBatch({
        projectRoot,
        outputDir: options.outputDir,
        batch: options.batch,
        epic: options.epic,
        story: options.story,
      });
    }

    const requirementFile = options.requirementFile?.trim() || undefined;
    let requirementDescription =
      options.requirementDescription?.trim() ||
      (batchContext ? `Batch: ${batchContext.batchName}` : "");

    if (requirementFile) {
      const absPath = path.resolve(projectRoot, requirementFile);
      try {
        const fileContent = await fs.readFile(absPath, "utf-8");
        if (fileContent.trim()) {
          requirementDescription = fileContent;
        }
      } catch (err) {
        throw new Error(
          `Failed to read requirement_file "${requirementFile}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const phaseState: WorkflowState = {
      workflowId: createWorkflowId(),
      workflowType,
      projectRoot,
      outputDir,
      requirementDescription,
      requirementFile,
      mode,
      status: "running",
      currentStep: null,
      completedSteps: [],
      skippedSteps: [],
      includeCodegen: options.includeCodegen ?? true,
      includeCodeReview: options.includeCodeReview ?? true,
      useLlm: options.useLlm ?? true,
      batch: options.batch ?? batchContext?.batchName,
      epic: options.epic,
      story: options.story,
      batchContext,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: nowIso(),
      cancelRequested: false,
      auditLog: [],
      artifacts: {},
    };

    const state: WorkflowState = {
      ...phaseState,
      chainPhases: [phaseState],
      currentChainPhase: 0,
      chainToPipeline,
    };

    if (mode === "dry-run") {
      const result = await this.runDryRunPreview(state);
      if (
        chainToPipeline &&
        result.state.workflowType === "planning" &&
        !result.state.batchContext
      ) {
        result.message +=
          "\n[chain] Dry-run mode: pipeline phase not started. Re-run without dry-run to chain.";
      }
      return result;
    }

    const planningResult = await this.execute(state);

    if (
      chainToPipeline &&
      !planningResult.dryRunPreview &&
      planningResult.state.status === "completed" &&
      planningResult.state.workflowType === "planning"
    ) {
      return this.runChainPipelinePhase(planningResult);
    }

    return planningResult;
  }

  async resume(projectRoot: string): Promise<WorkflowRunResult> {
    const root = joinPath(projectRoot);
    const state = await loadState(root);

    if (!state) {
      throw new Error(`No workflow state found at ${root}. Run start_bmad_workflow first.`);
    }

    const active = getActiveChainPhase(state);
    if (active.status === "completed") {
      return { state, message: "Workflow already completed." };
    }

    if (active.status === "cancelled") {
      throw new Error("Workflow was cancelled. Start a new workflow instead.");
    }

    if (active.mode === "dry-run") {
      return this.runDryRunPreview(state);
    }

    active.status = "running";
    active.cancelRequested = false;
    active.lastError = undefined;
    await saveState(state);

    return this.execute(state);
  }

  async getStatus(projectRoot: string): Promise<WorkflowStatusSummary | null> {
    const state = await loadState(joinPath(projectRoot));
    if (!state) return null;

    const active = getActiveChainPhase(state);
    const totalSteps = countApplicableSteps(active);
    const done = active.completedSteps.length;
    const progressPercent = totalSteps > 0 ? Math.round((done / totalSteps) * 100) : 0;

    return {
      workflowId: state.workflowId,
      workflowType: active.workflowType,
      status: active.status,
      mode: active.mode,
      currentStep: active.currentStep,
      completedSteps: active.completedSteps,
      skippedSteps: active.skippedSteps,
      progressPercent,
      lastError: active.lastError,
      outputDir: active.outputDir,
      batch: active.batch,
      updatedAt: state.updatedAt,
    };
  }

  async cancel(projectRoot: string): Promise<WorkflowState> {
    const root = joinPath(projectRoot);
    const state = await loadState(root);

    if (!state) {
      throw new Error(`No workflow state found at ${root}.`);
    }

    const active = getActiveChainPhase(state);
    if (active.status === "completed") {
      throw new Error("Cannot cancel a completed workflow.");
    }

    active.cancelRequested = true;
    active.status = "cancelled";
    state.status = "cancelled";
    if (Array.isArray(state.chainPhases)) {
      for (const phase of state.chainPhases) {
        phase.cancelRequested = true;
        if (phase.status === "running" || phase.status === "idle" || phase.status === "paused") {
          phase.status = "cancelled";
        }
      }
    }
    state.updatedAt = nowIso();
    await saveState(state);
    this.runningProjects.delete(root);
    return state;
  }

  private validateStartOptions(workflowType: WorkflowType, options: StartWorkflowOptions): void {
    if (workflowType !== "planning" && workflowType !== "pipeline") {
      throw new Error(`Invalid workflow_type: ${workflowType}. Must be "planning" or "pipeline".`);
    }
    if (
      workflowType === "planning" &&
      !options.requirementDescription?.trim() &&
      !options.requirementFile?.trim()
    ) {
      throw new Error(
        "requirement_description or requirement_file is required for planning workflow.",
      );
    }
  }

  private async runDryRunPreview(state: WorkflowState): Promise<WorkflowRunResult> {
    const preview: DryRunPreviewItem[] = [];
    const steps = getStepsForType(state.workflowType);
    const artifactBase =
      state.workflowType === "pipeline" && state.batchContext
        ? state.batchContext.pipelineOutputPath
        : state.outputDir;

    for (const step of steps) {
      const skipped =
        (step.id === "code_generation" && !state.includeCodegen) ||
        (step.id === "code_review" && !state.includeCodeReview) ||
        (step.id === "code_review_pipeline" && !state.includeCodeReview);

      const outputRel = getOutputFile(state.workflowType, step.id);
      preview.push({
        step: step.id,
        stepLabel: step.label,
        outputPath: outputRel ? joinPath(artifactBase, outputRel) : artifactBase,
        description: skipped
          ? "Would skip (optional step disabled)"
          : `Would generate ${outputRel ?? step.id}`,
        skipped,
      });
    }

    state.status = "completed";
    state.completedAt = nowIso();

    return {
      state,
      message: "Dry-run preview generated. No files written.",
      dryRunPreview: preview,
    };
  }

  private async runChainPipelinePhase(
    planningResult: WorkflowRunResult,
  ): Promise<WorkflowRunResult> {
    const parentState = planningResult.state;
    const inferred = await inferBatchFromPlanningArtifacts(parentState);

    if (!inferred) {
      planningResult.message +=
        "\n[chain] No batch directory found under planning-artifacts/. Pipeline phase not started.";
      return planningResult;
    }

    let batchContext;
    try {
      const outputRel = parentState.outputDir.startsWith(parentState.projectRoot)
        ? path.relative(parentState.projectRoot, parentState.outputDir)
        : ".bmad-output";
      batchContext = await resolveBatch({
        projectRoot: parentState.projectRoot,
        outputDir: outputRel,
        batch: inferred.name,
        epic: parentState.epic,
        story: parentState.story,
      });
    } catch (err) {
      planningResult.message += `\n[chain] Failed to resolve batch "${inferred.name}": ${err instanceof Error ? err.message : String(err)}`;
      return planningResult;
    }

    const pipelinePhase: WorkflowState = {
      ...parentState,
      workflowType: "pipeline",
      status: "running",
      currentStep: null,
      completedSteps: [],
      skippedSteps: [],
      includeCodegen: parentState.includeCodegen,
      includeCodeReview: parentState.includeCodeReview,
      batch: inferred.name,
      batchContext,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: nowIso(),
      completedAt: undefined,
      cancelRequested: false,
      lastError: undefined,
      auditLog: [],
      artifacts: {},
    };
    delete (pipelinePhase as { chainPhases?: unknown }).chainPhases;
    delete (pipelinePhase as { currentChainPhase?: unknown }).currentChainPhase;
    delete (pipelinePhase as { chainToPipeline?: unknown }).chainToPipeline;

    appendChainPhase(parentState, pipelinePhase);
    await saveState(parentState);

    const pipelineResult = await this.executeChainPhase(parentState, pipelinePhase);

    const summary = buildChainSummary(planningResult, pipelineResult, inferred.name);
    let chainSummaryPath: string | undefined;
    try {
      const summaryDir = planningResult.state.outputDir;
      await fs.mkdir(summaryDir, { recursive: true });
      chainSummaryPath = path.join(summaryDir, `chain-summary-${parentState.workflowId}.md`);
      await fs.writeFile(
        chainSummaryPath,
        renderChainSummaryMarkdown(summary),
        "utf-8",
      );
    } catch {
      chainSummaryPath = undefined;
    }

    return this.mergeChainResults(planningResult, pipelineResult, chainSummaryPath);
  }

  private async executeChainPhase(
    parentState: WorkflowState,
    phaseState: WorkflowState,
  ): Promise<WorkflowRunResult> {
    const root = parentState.projectRoot;
    if (this.runningProjects.has(root)) {
      throw new Error(`Workflow execution already in progress for ${root}.`);
    }
    this.runningProjects.add(root);
    try {
      await ensureOutputDir(phaseState);
      parentState.currentChainPhase =
        parentState.chainPhases!.length - 1;
      const result = await this.runStepsLoop(parentState);
      return result;
    } finally {
      this.runningProjects.delete(root);
    }
  }

  private mergeChainResults(
    planningResult: WorkflowRunResult,
    pipelineResult: WorkflowRunResult,
    chainSummaryPath: string | undefined,
  ): WorkflowRunResult {
    const planPhase = planningResult.state.chainPhases?.[0] ?? planningResult.state;
    const pipePhase =
      pipelineResult.state.chainPhases?.[pipelineResult.state.chainPhases!.length - 1] ??
      pipelineResult.state;

    const merged: WorkflowState = {
      ...planningResult.state,
      workflowType: pipePhase.workflowType,
      status: pipePhase.status,
      currentStep: pipePhase.currentStep,
      completedSteps: [...planPhase.completedSteps, ...pipePhase.completedSteps],
      skippedSteps: [...planPhase.skippedSteps, ...pipePhase.skippedSteps],
      auditLog: [...planPhase.auditLog, ...pipePhase.auditLog],
      batch: pipePhase.batch ?? planPhase.batch,
      batchContext: pipePhase.batchContext,
      lastError: pipePhase.lastError ?? planPhase.lastError,
      completedAt: pipePhase.completedAt,
      updatedAt: nowIso(),
    };
    merged.chainPhases = [planPhase, pipePhase];
    merged.currentChainPhase = 1;

    const summary = buildChainSummary(planningResult, pipelineResult, pipePhase.batch ?? null);
    const planLines = [
      `[chain] Planning ${planPhase.status} → Pipeline ${pipePhase.status}`,
      `[chain] Planning: ${planPhase.completedSteps.length} steps (${planPhase.skippedSteps.length} skipped)`,
      `[chain] Pipeline:  ${pipePhase.completedSteps.length} steps (${pipePhase.skippedSteps.length} skipped), batch=${pipePhase.batch ?? "(n/a)"}`,
      `[chain] Total: ${summary.totalDurationMs}ms`,
    ];
    if (chainSummaryPath) {
      planLines.push(`[chain] Full summary: ${chainSummaryPath}`);
    }
    if (pipePhase.lastError) {
      planLines.push(`[chain] Pipeline last error: ${pipePhase.lastError}`);
    }

    planningResult.message = `${planLines.join("\n")}\n${planningResult.message}`;

    return {
      state: merged,
      message: planningResult.message,
      chainSummaryPath,
    };
  }

  private async execute(state: WorkflowState): Promise<WorkflowRunResult> {
    const root = state.projectRoot;
    if (this.runningProjects.has(root)) {
      throw new Error(`Workflow execution already in progress for ${root}.`);
    }

    this.runningProjects.add(root);
    try {
      await ensureOutputDir(state);
      await saveState(state);
      return await this.runStepsLoop(state);
    } finally {
      this.runningProjects.delete(root);
    }
  }

  private async runStepsLoop(state: WorkflowState): Promise<WorkflowRunResult> {
    const phaseState = this.getActivePhase(state);
    let next = this.resolveNextStep(phaseState);

    while (next) {
      if (phaseState.cancelRequested) {
        phaseState.status = "cancelled";
        this.syncTopLevelFromPhase(state, phaseState);
        await saveState(state);
        return { state, message: "Workflow cancelled." };
      }

      phaseState.currentStep = next.id;
      this.syncTopLevelFromPhase(state, phaseState);
      await saveState(state);

      const result = await this.runStepWithRetry(phaseState, next.id);

      if (!result.success) {
        phaseState.status = "failed";
        phaseState.lastError = result.error;
        this.syncTopLevelFromPhase(state, phaseState);
        await saveState(state);
        await writeAuditLog(phaseState, false);
        return {
          state,
          message: `Workflow failed at step ${getStepLabel(phaseState.workflowType, next.id)}: ${result.error}`,
        };
      }

      if (result.outputFiles.length === 0 && next.optional) {
        if (!phaseState.skippedSteps.includes(next.id)) {
          phaseState.skippedSteps.push(next.id);
        }
      } else if (!phaseState.completedSteps.includes(next.id)) {
        phaseState.completedSteps.push(next.id);
      }

      next = getNextStep(phaseState.workflowType, next.id, phaseState);
    }

    phaseState.currentStep = null;
    phaseState.status = "completed";
    phaseState.completedAt = nowIso();
    this.syncTopLevelFromPhase(state, phaseState);
    await saveState(state);
    await writeAuditLog(phaseState, false);

    const artifactHint =
      phaseState.workflowType === "pipeline" && phaseState.batchContext
        ? phaseState.batchContext.pipelineOutputPath
        : phaseState.outputDir;

    return {
      state,
      message: `Workflow completed. Artifacts in ${artifactHint}`,
    };
  }

  private getActivePhase(state: WorkflowState): WorkflowState {
    if (Array.isArray(state.chainPhases) && state.chainPhases.length > 0) {
      const idx = state.currentChainPhase ?? state.chainPhases.length - 1;
      const safeIdx = Math.max(0, Math.min(idx, state.chainPhases.length - 1));
      return state.chainPhases[safeIdx];
    }
    return state;
  }

  private syncTopLevelFromPhase(topState: WorkflowState, phaseState: WorkflowState): void {
    if (topState === phaseState) return;
    topState.workflowType = phaseState.workflowType;
    topState.status = phaseState.status;
    topState.currentStep = phaseState.currentStep;
    topState.completedSteps = phaseState.completedSteps;
    topState.skippedSteps = phaseState.skippedSteps;
    topState.auditLog = phaseState.auditLog;
    topState.batch = phaseState.batch;
    topState.batchContext = phaseState.batchContext;
    topState.lastError = phaseState.lastError;
    topState.completedAt = phaseState.completedAt;
    topState.startedAt = phaseState.startedAt;
  }

  private async runStepWithRetry(
    state: WorkflowState,
    stepId: WorkflowStepId,
  ): Promise<{ success: boolean; error?: string; outputFiles: string[] }> {
    const step = getStepById(state.workflowType, stepId);
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_STEP_RETRIES; attempt++) {
      const startedAt = nowIso();
      const startMs = Date.now();

      try {
        const ctx = { state, dryRun: false };
        const result = await step.execute(ctx);

        const endedAt = nowIso();
        const durationMs = Date.now() - startMs;
        const outputText = result.content ?? result.outputSummary;

        const audit: StepAuditEntry = {
          step: stepId,
          stepLabel: step.label,
          startedAt,
          endedAt,
          durationMs,
          inputSummary: truncate(state.requirementDescription, 120),
          outputSummary: result.outputSummary,
          outputFiles: result.outputFiles,
          tokenEstimate: await estimateTokens(outputText),
          success: result.success,
          error: result.error,
          retryCount: attempt,
          phase: state.workflowType,
        };

        state.auditLog.push(audit);
        await saveState(state);

        if (result.success) {
          return { success: true, outputFiles: result.outputFiles };
        }
        lastError = result.error ?? "Step returned failure";
      } catch (err) {
        const endedAt = nowIso();
        const durationMs = Date.now() - startMs;
        lastError = err instanceof Error ? err.message : String(err);

        state.auditLog.push({
          step: stepId,
          stepLabel: step.label,
          startedAt,
          endedAt,
          durationMs,
          inputSummary: truncate(state.requirementDescription, 120),
          outputSummary: "",
          outputFiles: [],
          tokenEstimate: 0,
          success: false,
          error: lastError,
          retryCount: attempt,
          phase: state.workflowType,
        });
        await saveState(state);
      }
    }

    return { success: false, error: lastError, outputFiles: [] };
  }

  private resolveNextStep(state: WorkflowState) {
    if (
      state.currentStep &&
      !state.completedSteps.includes(state.currentStep) &&
      state.status !== "completed"
    ) {
      return getStepById(state.workflowType, state.currentStep);
    }

    const lastCompleted =
      state.completedSteps.length > 0
        ? state.completedSteps[state.completedSteps.length - 1]
        : null;

    return getNextStep(state.workflowType, lastCompleted, state);
  }
}

export const workflowEngine = new WorkflowEngine();
export { CHAIN_MAX_SUMMARY_LINES, CHAIN_PREVIEW_LINES };

