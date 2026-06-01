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
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw) as WorkflowState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveState(state: WorkflowState): Promise<void> {
  const statePath = getStateFilePath(state.projectRoot);
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
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
