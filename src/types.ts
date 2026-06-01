import type { PLANNING_STEPS, PIPELINE_STEPS } from "./constants.js";

export type PlanningStepId = (typeof PLANNING_STEPS)[number];
export type PipelineStepId = (typeof PIPELINE_STEPS)[number];
export type WorkflowStepId = PlanningStepId | PipelineStepId;

export type WorkflowType = "planning" | "pipeline";
export type WorkflowMode = "normal" | "dry-run";
export type WorkflowStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface StoryEntry {
  key: string;
  title: string;
  status: string;
  epic?: string;
  sprint?: string;
  priority?: string;
  filePattern?: string;
}

export interface BatchInfo {
  name: string;
  planningPath: string;
  implementationPath: string;
  hasPrd: boolean;
  hasEpics: boolean;
  hasSprintStatus: boolean;
  sprintStatusFormat?: "yaml" | "markdown";
}

export interface BatchContext {
  batchName: string;
  planningArtifactsPath: string;
  implementationArtifactsPath: string;
  sprintStatusPath?: string;
  sprintStatusFormat?: "yaml" | "markdown";
  targetEpic?: string;
  targetStory?: string;
  selectedStories: StoryEntry[];
  pipelineOutputPath: string;
}

export interface StepAuditEntry {
  step: WorkflowStepId;
  stepLabel: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  inputSummary: string;
  outputSummary: string;
  outputFiles: string[];
  tokenEstimate: number;
  success: boolean;
  error?: string;
  retryCount: number;
}

export interface WorkflowState {
  workflowId: string;
  workflowType: WorkflowType;
  projectRoot: string;
  outputDir: string;
  requirementDescription: string;
  mode: WorkflowMode;
  status: WorkflowStatus;
  currentStep: WorkflowStepId | null;
  completedSteps: WorkflowStepId[];
  skippedSteps: WorkflowStepId[];
  includeCodegen: boolean;
  includeCodeReview: boolean;
  useLlm: boolean;
  batch?: string;
  epic?: string;
  story?: string;
  batchContext?: BatchContext;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  cancelRequested: boolean;
  auditLog: StepAuditEntry[];
  artifacts: Record<string, string>;
}

export interface StepContext {
  state: WorkflowState;
  dryRun: boolean;
}

export interface StepResult {
  success: boolean;
  outputFiles: string[];
  outputSummary: string;
  content?: string;
  error?: string;
  nextStep?: WorkflowStepId | null;
}

export interface StepDefinition {
  id: WorkflowStepId;
  label: string;
  optional?: boolean;
  execute: (ctx: StepContext) => Promise<StepResult>;
}

export interface StartWorkflowOptions {
  projectRoot: string;
  outputDir: string;
  requirementDescription?: string;
  workflowType?: WorkflowType;
  mode?: WorkflowMode;
  includeCodegen?: boolean;
  includeCodeReview?: boolean;
  useLlm?: boolean;
  batch?: string;
  epic?: string;
  story?: string;
}

export interface WorkflowRunResult {
  state: WorkflowState;
  message: string;
  dryRunPreview?: DryRunPreviewItem[];
}

export interface DryRunPreviewItem {
  step: WorkflowStepId;
  stepLabel: string;
  outputPath: string;
  description: string;
  skipped?: boolean;
}

export interface WorkflowStatusSummary {
  workflowId: string;
  workflowType: WorkflowType;
  status: WorkflowStatus;
  mode: WorkflowMode;
  currentStep: WorkflowStepId | null;
  completedSteps: WorkflowStepId[];
  skippedSteps: WorkflowStepId[];
  progressPercent: number;
  lastError?: string;
  outputDir: string;
  batch?: string;
  updatedAt: string;
}

export interface ListBatchesOptions {
  projectRoot: string;
  outputDir: string;
}
