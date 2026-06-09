import fs from "node:fs/promises";
import path from "node:path";
import { AUDIT_LOG_FILENAME, STATE_FILENAME } from "../constants.js";
import type { WorkflowState } from "../types.js";
import { joinPath } from "../utils.js";

export function getStateFilePath(projectRoot: string): string {
  return joinPath(projectRoot, STATE_FILENAME);
}

export function resolveOutputDir(projectRoot: string, outputDir: string): string {
  return joinPath(projectRoot, outputDir);
}

export async function loadState(projectRoot: string): Promise<WorkflowState | null> {
  const statePath = getStateFilePath(projectRoot);
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as WorkflowState;
  return migrateStateSchema(parsed);
}

function migrateStateSchema(state: WorkflowState): WorkflowState {
  if (Array.isArray(state.chainPhases) && state.chainPhases.length > 0) {
    state.chainPhases = state.chainPhases.map((p) => migrateStateSchema(p));
    if (state.currentChainPhase === undefined) {
      state.currentChainPhase = state.chainPhases.length - 1;
    }
    return state;
  }

  const phase: WorkflowState = {
    ...state,
    chainPhases: undefined,
  };
  state.chainPhases = [phase];
  state.currentChainPhase = 0;
  return state;
}

export async function saveState(state: WorkflowState): Promise<void> {
  const statePath = getStateFilePath(state.projectRoot);
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  try {
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function getActiveChainPhase(state: WorkflowState): WorkflowState {
  if (!Array.isArray(state.chainPhases) || state.chainPhases.length === 0) {
    return state;
  }
  const idx = state.currentChainPhase ?? 0;
  return state.chainPhases[Math.max(0, Math.min(idx, state.chainPhases.length - 1))];
}

export function appendChainPhase(parent: WorkflowState, phase: WorkflowState): void {
  if (!Array.isArray(parent.chainPhases)) {
    parent.chainPhases = [parent];
  }
  parent.chainPhases.push(phase);
  parent.currentChainPhase = parent.chainPhases.length - 1;
}

export function syncChainPhaseToTopLevel(state: WorkflowState): void {
  const active = getActiveChainPhase(state);
  state.workflowType = active.workflowType;
  state.status = active.status;
  state.currentStep = active.currentStep;
  state.completedSteps = active.completedSteps;
  state.skippedSteps = active.skippedSteps;
  state.auditLog = active.auditLog;
  state.batch = active.batch;
  state.batchContext = active.batchContext;
  state.lastError = active.lastError;
  state.completedAt = active.completedAt;
  state.startedAt = active.startedAt;
}

export async function ensureOutputDir(state: WorkflowState): Promise<string> {
  await fs.mkdir(state.outputDir, { recursive: true });
  if (state.batchContext?.pipelineOutputPath) {
    await fs.mkdir(state.batchContext.pipelineOutputPath, { recursive: true });
  }
  return state.outputDir;
}

export async function writeArtifact(
  state: WorkflowState,
  relativePath: string,
  content: string,
  dryRun: boolean,
  basePath?: string,
): Promise<string> {
  const root = basePath ?? state.outputDir;
  const fullPath = joinPath(root, relativePath);
  if (dryRun) {
    return fullPath;
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
  return fullPath;
}

export async function writeAuditLog(state: WorkflowState, dryRun: boolean): Promise<string> {
  const auditBase = state.batchContext?.pipelineOutputPath ?? state.outputDir;
  const auditPath = joinPath(auditBase, AUDIT_LOG_FILENAME);
  if (dryRun) {
    return auditPath;
  }
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.writeFile(auditPath, JSON.stringify(state.auditLog, null, 2), "utf-8");
  return auditPath;
}

export async function readArtifactIfExists(
  state: WorkflowState,
  relativePath: string,
  basePath?: string,
): Promise<string | null> {
  try {
    return await fs.readFile(joinPath(basePath ?? state.outputDir, relativePath), "utf-8");
  } catch {
    return null;
  }
}
