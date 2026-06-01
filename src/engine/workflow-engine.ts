import {
  MAX_STEP_RETRIES,
  getOutputFile,
  getStepLabel,
} from "../constants.js";
import { listBatches, resolveBatch } from "../services/batch-resolver.js";
import { estimateTokens } from "../services/token-estimator.js";
import {
  ensureOutputDir,
  loadState,
  resolveOutputDir,
  saveState,
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
    if (existing?.status === "running") {
      throw new Error(
        `Workflow already running for ${projectRoot}. Use resume_bmad_workflow or cancel_workflow first.`,
      );
    }

    const mode = options.mode ?? "normal";
    const outputDir = resolveOutputDir(projectRoot, options.outputDir);

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

    const requirementDescription =
      options.requirementDescription?.trim() ||
      (batchContext ? `Batch: ${batchContext.batchName}` : "");

    const state: WorkflowState = {
      workflowId: createWorkflowId(),
      workflowType,
      projectRoot,
      outputDir,
      requirementDescription,
      mode,
      status: "running",
      currentStep: null,
      completedSteps: [],
      skippedSteps: [],
      includeCodegen: options.includeCodegen ?? true,
      includeCodeReview: options.includeCodeReview ?? true,
      useLlm: options.useLlm ?? false,
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

    if (mode === "dry-run") {
      return this.runDryRunPreview(state);
    }

    return this.execute(state);
  }

  async resume(projectRoot: string): Promise<WorkflowRunResult> {
    const root = joinPath(projectRoot);
    const state = await loadState(root);

    if (!state) {
      throw new Error(`No workflow state found at ${root}. Run start_bmad_workflow first.`);
    }

    if (state.status === "completed") {
      return { state, message: "Workflow already completed." };
    }

    if (state.status === "cancelled") {
      throw new Error("Workflow was cancelled. Start a new workflow instead.");
    }

    if (state.mode === "dry-run") {
      return this.runDryRunPreview(state);
    }

    state.status = "running";
    state.cancelRequested = false;
    state.lastError = undefined;
    await saveState(state);

    return this.execute(state);
  }

  async getStatus(projectRoot: string): Promise<WorkflowStatusSummary | null> {
    const state = await loadState(joinPath(projectRoot));
    if (!state) return null;

    const totalSteps = countApplicableSteps(state);
    const done = state.completedSteps.length;
    const progressPercent = totalSteps > 0 ? Math.round((done / totalSteps) * 100) : 0;

    return {
      workflowId: state.workflowId,
      workflowType: state.workflowType,
      status: state.status,
      mode: state.mode,
      currentStep: state.currentStep,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      progressPercent,
      lastError: state.lastError,
      outputDir: state.outputDir,
      batch: state.batch,
      updatedAt: state.updatedAt,
    };
  }

  async cancel(projectRoot: string): Promise<WorkflowState> {
    const root = joinPath(projectRoot);
    const state = await loadState(root);

    if (!state) {
      throw new Error(`No workflow state found at ${root}.`);
    }

    if (state.status === "completed") {
      throw new Error("Cannot cancel a completed workflow.");
    }

    state.cancelRequested = true;
    state.status = "cancelled";
    state.updatedAt = nowIso();
    await saveState(state);
    this.runningProjects.delete(root);
    return state;
  }

  private validateStartOptions(workflowType: WorkflowType, options: StartWorkflowOptions): void {
    if (workflowType === "planning" && !options.requirementDescription?.trim()) {
      throw new Error("requirement_description is required for planning workflow.");
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

  private async execute(state: WorkflowState): Promise<WorkflowRunResult> {
    const root = state.projectRoot;
    if (this.runningProjects.has(root)) {
      throw new Error(`Workflow execution already in progress for ${root}.`);
    }

    this.runningProjects.add(root);
    try {
      await ensureOutputDir(state);
      await saveState(state);

      let next = this.resolveNextStep(state);

      while (next) {
        if (state.cancelRequested) {
          state.status = "cancelled";
          await saveState(state);
          return { state, message: "Workflow cancelled." };
        }

        state.currentStep = next.id;
        await saveState(state);

        const result = await this.runStepWithRetry(state, next.id);

        if (!result.success) {
          state.status = "failed";
          state.lastError = result.error;
          await saveState(state);
          await writeAuditLog(state, false);
          return {
            state,
            message: `Workflow failed at step ${getStepLabel(state.workflowType, next.id)}: ${result.error}`,
          };
        }

        if (result.outputFiles.length === 0 && next.optional) {
          if (!state.skippedSteps.includes(next.id)) {
            state.skippedSteps.push(next.id);
          }
        } else if (!state.completedSteps.includes(next.id)) {
          state.completedSteps.push(next.id);
        }

        next = getNextStep(state.workflowType, next.id, state);
      }

      state.currentStep = null;
      state.status = "completed";
      state.completedAt = nowIso();
      await saveState(state);
      await writeAuditLog(state, false);

      const artifactHint =
        state.workflowType === "pipeline" && state.batchContext
          ? state.batchContext.pipelineOutputPath
          : state.outputDir;

      return {
        state,
        message: `Workflow completed. Artifacts in ${artifactHint}`,
      };
    } finally {
      this.runningProjects.delete(root);
    }
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
